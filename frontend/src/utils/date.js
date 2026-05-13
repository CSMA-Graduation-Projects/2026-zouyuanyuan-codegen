import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export function formatDateTime(isoString) {
  if (!isoString) return '';
  // 服务端存储的是 UTC 时间，转为本地时区显示
  return dayjs.utc(isoString).local().format('YYYY-MM-DD HH:mm:ss');
}