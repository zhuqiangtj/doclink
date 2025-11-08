export function getStatusText(status: string): string {
  const statusMap: { [key: string]: string } = {
    PENDING: '待就诊',
// 将任何旧资料中的 CHECKED_IN 视为待就诊，以保留四状态显示规范
    CHECKED_IN: '待就诊',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
    NO_SHOW: '未到诊',
  };
  return statusMap[status] || status;
}

export function getActionText(action: string): string {
  const actionMap: { [key: string]: string } = {
    CREATE: '创建预约',
    UPDATE_STATUS_TO_PENDING: '更新为待就诊',
// 不再存在 CHECKED_IN 状态，将相关动作映射为待就诊
    UPDATE_STATUS_TO_CHECKED_IN: '更新为待就诊',
    UPDATE_STATUS_TO_COMPLETED: '更新为已完成',
    UPDATE_STATUS_TO_CANCELLED: '更新为已取消',
    UPDATE_STATUS_TO_NO_SHOW: '更新为未到诊',
    CANCEL_APPOINTMENT: '取消预约',
    CHECKIN: '病人报到',
    MARK_NO_SHOW: '标记未到诊',
  };
  return actionMap[action] || action;
}