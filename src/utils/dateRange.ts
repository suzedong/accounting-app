export function getDateRange(range: 'day' | 'week' | 'month' | 'last_month' | 'year'): {
  dateFrom: string;
  dateTo: string;
  periodName: string;
} {
  const now = new Date();
  let dateFrom: Date;
  let dateTo = now;
  let periodName = '';

  switch (range) {
    case 'day': {
      dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      periodName = '今日';
      break;
    }
    case 'week': {
      dateFrom = new Date(now);
      dateFrom.setDate(now.getDate() - 6);
      periodName = '近 7 天';
      break;
    }
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
