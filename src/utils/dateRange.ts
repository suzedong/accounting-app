export function getDateRange(range: 'month' | 'last_month' | 'week' | 'year'): {
  dateFrom: string;
  dateTo: string;
  periodName: string;
} {
  const now = new Date();
  let dateFrom: Date;
  let dateTo = now;
  let periodName = '';

  switch (range) {
    case 'month': {
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      periodName = '本月';
      break;
    }
    case 'last_month': {
      dateFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      dateTo = new Date(now.getFullYear(), now.getMonth(), 0);
      periodName = '上月';
      break;
    }
    case 'week': {
      dateFrom = new Date(now);
      dateFrom.setDate(now.getDate() - now.getDay() + 1);
      periodName = '本周';
      break;
    }
    case 'year': {
      dateFrom = new Date(now.getFullYear(), 0, 1);
      periodName = '本年';
      break;
    }
    default: {
      dateFrom = new Date(now.getFullYear(), now.getMonth(), 1);
      periodName = '本月';
    }
  }

  return {
    dateFrom: `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, '0')}-${String(dateFrom.getDate()).padStart(2, '0')} 00:00:00`,
    dateTo: `${dateTo.getFullYear()}-${String(dateTo.getMonth() + 1).padStart(2, '0')}-${String(dateTo.getDate()).padStart(2, '0')} 23:59:59`,
    periodName,
  };
}
