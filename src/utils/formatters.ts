export function formatMoney(amount: number): string {
  return `¥${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function formatIntMoney(amount: number): string {
  return `¥${Math.round(amount).toLocaleString()}`;
}

export function formatDatetime(datetime: string): string {
  if (!datetime) return '';
  
  const dt = datetime.replace('T', ' ').substring(0, 19);
  const date = new Date(datetime.replace('T', ' '));
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[date.getDay()];
  
  return `${dt} ${weekday}`;
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
