use chrono::Datelike;
use libsql::params;
use serde::Serialize;

use crate::db::connection::Database;

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
    state: tauri::State<'_, Database>,
    datetime_gte: String,
    datetime_lte: Option<String>,
    account: Option<String>,
) -> Result<StatsSummary, String> {
    let conn = state.get_conn().await?;
    let date_filter = build_date_filter(&datetime_gte, datetime_lte.as_deref());
    let account_filter = build_account_filter(account.as_deref());

    let (expense_total, expense_count) = query_sum_count(
        &conn,
        &format!(
            "SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM records WHERE type = '支出' {} {}",
            date_filter, account_filter
        ),
    )
    .await?;

    let (income_total, income_count) = query_sum_count(
        &conn,
        &format!(
            "SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM records WHERE type = '收入' {} {}",
            date_filter, account_filter
        ),
    )
    .await?;

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
    state: tauri::State<'_, Database>,
    datetime_gte: String,
    r#type: String,
    datetime_lte: Option<String>,
    account: Option<String>,
) -> Result<Vec<CategoryStat>, String> {
    let conn = state.get_conn().await?;
    let date_filter = build_date_filter(&datetime_gte, datetime_lte.as_deref());
    let account_filter = build_account_filter(account.as_deref());

    let sql = format!(
        "SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM records WHERE type = ? {} {} GROUP BY category ORDER BY total DESC",
        date_filter, account_filter
    );
    let mut rows = conn
        .query(&sql, params![r#type])
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        result.push(CategoryStat {
            category: row.get::<Option<String>>(0).map_err(|e| e.to_string())?.unwrap_or_else(|| "未分类".into()),
            total: row_get_f64(&row, 1)?,
            count: row_get_i64(&row, 2)?,
        });
    }
    Ok(result)
}

#[derive(Serialize)]
pub struct AccountStat {
    pub account: String,
    pub total: f64,
    pub count: i64,
}

#[tauri::command]
pub async fn get_stats_by_account(
    state: tauri::State<'_, Database>,
    datetime_gte: String,
    datetime_lte: Option<String>,
) -> Result<Vec<AccountStat>, String> {
    let conn = state.get_conn().await?;
    let date_filter = build_date_filter(&datetime_gte, datetime_lte.as_deref());

    let sql = format!(
        "SELECT account, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM records WHERE type = '支出' {} GROUP BY account ORDER BY total DESC",
        date_filter
    );
    let mut rows = conn.query(&sql, ()).await.map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        result.push(AccountStat {
            account: row.get::<Option<String>>(0).map_err(|e| e.to_string())?.unwrap_or_else(|| "未分类".into()),
            total: row_get_f64(&row, 1)?,
            count: row_get_i64(&row, 2)?,
        });
    }
    Ok(result)
}

#[derive(Serialize)]
pub struct MonthTrend {
    pub month: String,
    pub income: f64,
    pub expense: f64,
}

#[tauri::command]
pub async fn get_monthly_trend(
    state: tauri::State<'_, Database>,
    months: Option<u32>,
    account: Option<String>,
) -> Result<Vec<MonthTrend>, String> {
    let conn = state.get_conn().await?;
    let n = months.unwrap_or(6) as i64;
    let account_filter = build_account_filter(account.as_deref());

    let sql = format!(
        "SELECT strftime('%Y-%m', datetime) as month,
                COALESCE(SUM(CASE WHEN type = '收入' THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN type = '支出' THEN amount ELSE 0 END), 0) as expense
         FROM records
         WHERE 1=1 {}
         GROUP BY month
         ORDER BY month DESC
         LIMIT ?",
        account_filter
    );
    let mut rows = conn
        .query(&sql, params![n])
        .await
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        results.push(MonthTrend {
            month: row.get::<Option<String>>(0).map_err(|e| e.to_string())?.unwrap_or_default(),
            income: row_get_f64(&row, 1)?,
            expense: row_get_f64(&row, 2)?,
        });
    }

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
pub async fn get_comparison(state: tauri::State<'_, Database>) -> Result<ComparisonResult, String> {
    let conn = state.get_conn().await?;
    let now = chrono::Local::now();
    let current_month = now.format("%Y-%m").to_string();
    let prev = now - chrono::Months::new(1);
    let prev_month = prev.format("%Y-%m").to_string();

    let current = get_month_stats(&conn, &current_month).await?;
    let previous = get_month_stats(&conn, &prev_month).await?;

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
    state: tauri::State<'_, Database>,
    _period: String,
    budget_monthly: f64,
) -> Result<BudgetAnalysis, String> {
    let conn = state.get_conn().await?;
    let now = chrono::Local::now();
    let month = now.format("%Y-%m").to_string();
    let total_days = match now.date_naive().month() {
        2 => {
            let y = now.year();
            if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    } as i64;
    let day = now.date_naive().day() as i64;
    let remaining_days = total_days - day;

    let date_gte = format!("{}-01 00:00:00", month);

    let sql = format!(
        "SELECT COALESCE(SUM(amount), 0) FROM records WHERE type = '支出' AND account = '个人' AND datetime >= '{}'",
        date_gte
    );
    let mut rows = conn.query(&sql, ()).await.map_err(|e| e.to_string())?;
    let actual_expense: f64 = match rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => row_get_f64(&row, 0)?,
        None => 0.0,
    };

    let usage_rate = if budget_monthly > 0.0 {
        (actual_expense / budget_monthly) * 100.0
    } else {
        0.0
    };

    let remaining = budget_monthly - actual_expense;
    let daily_avg = if day > 0 { actual_expense / day as f64 } else { 0.0 };
    let daily_remaining = if remaining_days > 0 {
        remaining / remaining_days as f64
    } else {
        0.0
    };

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

/// 构造 account 过滤子句（用于按账户维度筛选：个人 / 家庭 / 公司）
/// 由于 account 值来自枚举白名单（非用户自由输入），此处直接内联字符串即可
fn build_account_filter(account: Option<&str>) -> String {
    match account {
        Some(a) if !a.is_empty() => format!("AND account = '{}'", a.replace('\'', "''")),
        _ => String::new(),
    }
}

async fn query_sum_count(conn: &libsql::Connection, sql: &str) -> Result<(f64, i64), String> {
    let mut rows = conn.query(sql, ()).await.map_err(|e| e.to_string())?;
    match rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => Ok((row_get_f64(&row, 0)?, row_get_i64(&row, 1)?)),
        None => Ok((0.0, 0)),
    }
}

/// 从 row 取 f64，兼容 Integer/Real/Null（libsql 0.9 严格 f64 遇到 Integer/Null 会 panic）
fn row_get_f64(row: &libsql::Row, idx: i32) -> Result<f64, String> {
    match row.get_value(idx).map_err(|e| e.to_string())? {
        libsql::Value::Real(v) => Ok(v),
        libsql::Value::Integer(v) => Ok(v as f64),
        libsql::Value::Null => Ok(0.0),
        libsql::Value::Text(s) => s.parse::<f64>().map_err(|e| e.to_string()),
        libsql::Value::Blob(_) => Err("blob cannot convert to f64".into()),
    }
}

/// 从 row 取 i64，兼容 Real/Integer/Null
fn row_get_i64(row: &libsql::Row, idx: i32) -> Result<i64, String> {
    match row.get_value(idx).map_err(|e| e.to_string())? {
        libsql::Value::Integer(v) => Ok(v),
        libsql::Value::Real(v) => Ok(v as i64),
        libsql::Value::Null => Ok(0),
        libsql::Value::Text(s) => s.parse::<i64>().map_err(|e| e.to_string()),
        libsql::Value::Blob(_) => Err("blob cannot convert to i64".into()),
    }
}

async fn get_month_stats(
    conn: &libsql::Connection,
    month: &str,
) -> Result<ComparisonPeriod, String> {
    let sql = format!(
        "SELECT
            COALESCE(SUM(CASE WHEN type = '收入' THEN amount ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN type = '支出' THEN amount ELSE 0 END), 0)
         FROM records WHERE datetime LIKE '{}%'",
        month
    );
    let mut rows = conn.query(&sql, ()).await.map_err(|e| e.to_string())?;
    let (income, expense) = match rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => (row_get_f64(&row, 0)?, row_get_f64(&row, 1)?),
        None => (0.0, 0.0),
    };

    Ok(ComparisonPeriod {
        label: month.to_string(),
        income,
        expense,
        balance: income - expense,
    })
}
