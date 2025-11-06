export function getStatusText(status: string): string {
  const statusMap: { [key: string]: string } = {
    PENDING: '待就診',
    // 將任何舊資料中的 CHECKED_IN 視為待就診，以保留四狀態顯示規範
    CHECKED_IN: '待就診',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
    NO_SHOW: '未到診',
  };
  return statusMap[status] || status;
}

export function getActionText(action: string): string {
  const actionMap: { [key: string]: string } = {
    CREATE: '創建預約',
    UPDATE_STATUS_TO_PENDING: '更新為待就診',
    // 不再存在 CHECKED_IN 狀態，將相關動作映射為待就診
    UPDATE_STATUS_TO_CHECKED_IN: '更新為待就診',
    UPDATE_STATUS_TO_COMPLETED: '更新為已完成',
    UPDATE_STATUS_TO_CANCELLED: '更新為已取消',
    UPDATE_STATUS_TO_NO_SHOW: '更新為未到診',
    CHECKIN: '病人報到',
    MARK_NO_SHOW: '標記未到診',
  };
  return actionMap[action] || action;
}