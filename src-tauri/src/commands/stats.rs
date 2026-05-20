use chrono::{Datelike, Months};
use serde::Serialize;
use tauri::State;

use crate::db::Database;

#[derive(Serialize)]
pub struct StatsSummary {
    pub expense_total: f64,
    pub expense_count: i64,
    pub income_total: f64,
    pub income_count: i64,
    pub balance: f64,
}

#[tauri::command]
pub async fn get_stats_summary(
    state: State<'_, Database>,
    datetime_gte: String,
    datetime_lte: Option<String>,
) -> Result<StatsSummary, String> {
    let conn = state.get_conn()?;
    let date_filter = build_date_filter(&datetime_gte, datetime_lte.as_deref());

    let (expense_total, expense_count) = conn
        .query_row(
            &format!("SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM records WHERE type = '支出' {}", date_filter),
            [],
            |row| Ok((row.get::<_, f64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let (income_total, income_count) = conn
        .query_row(
            &format!("SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM records WHERE type = '收入' {}", date_filter),
            [],
            |row| Ok((row.get::<_, f64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| e.to_string())?;

    Ok(StatsSummary {
        expense_total,
        expense_count,
        income_total,
        income_count,
        balance: income_total - expense_total,
    })
}

#[derive(Serialize)]
pub struct CategoryStat {
    pub category: String,
    pub total: f64,
    pub count: i64,
}

#[tauri::command]
pub async fn get_stats_by_category(
    state: State<'_, Database>,
    datetime_gte: String,
    r#type: String,
    datetime_lte: Option<String>,
) -> Result<Vec<CategoryStat>, String> {
    let conn = state.get_conn()?;
    let date_filter = build_date_filter(&datetime_gte, datetime_lte.as_deref());

    let mut stmt = conn
        .prepare(&format!(
            "SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM records WHERE type = ? {} GROUP BY category ORDER BY total DESC",
            date_filter
        ))
        .map_err(|e| e.to_string())?;

    stmt.query_map([&r#type], |row| {
        Ok(CategoryStat {
            category: row.get(0)?,
            total: row.get(1)?,
            count: row.get(2)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect()
}

#[derive(Serialize)]
pub struct AccountStat {
    pub account: String,
    pub total: f64,
    pub count: i64,
}

#[tauri::command]
pub async fn get_stats_by_account(
    state: State<'_, Database>,
    datetime_gte: String,
    datetime_lte: Option<String>,
) -> Result<Vec<AccountStat>, String> {
    let conn = state.get_conn()?;
    let date_filter = build_date_filter(&datetime_gte, datetime_lte.as_deref());

    let mut stmt = conn
        .prepare(&format!(
            "SELECT account, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM records WHERE type = '支出' {} GROUP BY account ORDER BY total DESC",
            date_filter
        ))
        .map_err(|e| e.to_string())?;

    stmt.query_map([], |row| {
        Ok(AccountStat {
            account: row.get(0)?,
            total: row.get(1)?,
            count: row.get(2)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect()
}

#[derive(Serialize)]
pub struct MonthTrend {
    pub month: String,
    pub income: f64,
    pub expense: f64,
}

#[tauri::command]
pub async fn get_monthly_trend(
    state: State<'_, Database>,
    months: Option<u32>,
) -> Result<Vec<MonthTrend>, String> {
    let conn = state.get_conn()?;
    let n = months.unwrap_or(6);

    let mut stmt = conn
        .prepare(
            "SELECT strftime('%Y-%m', datetime) as month,
                    COALESCE(SUM(CASE WHEN type = '收入' THEN amount ELSE 0 END), 0) as income,
                    COALESCE(SUM(CASE WHEN type = '支出' THEN amount ELSE 0 END), 0) as expense
             FROM records
             GROUP BY month
             ORDER BY month DESC
             LIMIT ?",
        )
        .map_err(|e| e.to_string())?;

    let mut results: Vec<MonthTrend> = stmt
        .query_map([n], |row| {
            Ok(MonthTrend {
                month: row.get(0)?,
                income: row.get(1)?,
                expense: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    results.reverse();
    Ok(results)
}

#[derive(Serialize)]
pub struct ComparisonPeriod {
    pub label: String,
    pub income: f64,
    pub expense: f64,
    pub balance: f64,
}

#[derive(Serialize)]
pub struct ComparisonResult {
    pub current: ComparisonPeriod,
    pub previous: ComparisonPeriod,
}

#[tauri::command]
pub async fn get_comparison(state: State<'_, Database>) -> Result<ComparisonResult, String> {
    let conn = state.get_conn()?;
    let now = chrono::Local::now();
    let current_month = now.format("%Y-%m").to_string();
    let prev = now - chrono::Months::new(1);
    let prev_month = prev.format("%Y-%m").to_string();

    let current = get_month_stats(&conn, &current_month)?;
    let previous = get_month_stats(&conn, &prev_month)?;

    Ok(ComparisonResult { current, previous })
}

#[derive(Serialize)]
pub struct BudgetAnalysis {
    pub budget_monthly: f64,
    pub actual_expense: f64,
    pub usage_rate: f64,
    pub remaining: f64,
    pub days: i64,
    pub remaining_days: i64,
    pub daily_avg: f64,
    pub daily_remaining: f64,
    pub status: String,
}

#[tauri::command]
pub async fn get_budget_analysis(
    state: State<'_, Database>,
    _period: String,
    budget_monthly: f64,
) -> Result<BudgetAnalysis, String> {
    let conn = state.get_conn()?;
    let now = chrono::Local::now();
    let month = now.format("%Y-%m").to_string();
    let total_days = now.date_naive().month().length() as i64;
    let day = now.date_naive().day() as i64;
    let remaining_days = total_days - day;

    let date_gte = format!("{}-01 00:00:00", month);

    let actual_expense: f64 = conn
        .query_row(
            &format!("SELECT COALESCE(SUM(amount), 0) FROM records WHERE type = '支出' AND datetime >= '{}'", date_gte),
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let usage_rate = if budget_monthly > 0.0 {
        (actual_expense / budget_monthly) * 100.0
    } else {
        0.0
    };

    let remaining = budget_monthly - actual_expense;
    let daily_avg = if day > 0 { actual_expense / day as f64 } else { 0.0 };
    let daily_remaining = if remaining_days > 0 { remaining / remaining_days as f64 } else { 0.0 };

    let status = if usage_rate > 100.0 {
        "超支".to_string()
    } else if usage_rate > 80.0 {
        "紧张".to_string()
    } else {
        "正常".to_string()
    };

    Ok(BudgetAnalysis {
        budget_monthly,
        actual_expense,
        usage_rate,
        remaining,
        days: day,
        remaining_days,
        daily_avg,
        daily_remaining,
        status,
    })
}

fn build_date_filter(gte: &str, lte: Option<&str>) -> String {
    match lte {
        Some(l) => format!("AND datetime >= '{}' AND datetime <= '{}'", gte, l),
        None => format!("AND datetime >= '{}'", gte),
    }
}

fn get_month_stats(conn: &rusqlite::Connection, month: &str) -> Result<ComparisonPeriod, String> {
    let (income, expense) = conn
        .query_row(
            &format!(
                "SELECT
                    COALESCE(SUM(CASE WHEN type = '收入' THEN amount ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN type = '支出' THEN amount ELSE 0 END), 0)
                 FROM records WHERE datetime LIKE '{}%'",
                month
            ),
            [],
            |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
        )
        .map_err(|e| e.to_string())?;

    Ok(ComparisonPeriod {
        label: month.to_string(),
        income,
        expense,
        balance: income - expense,
    })
}
