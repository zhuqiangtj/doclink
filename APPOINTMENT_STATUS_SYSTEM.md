# 預約狀態系統

## 概述
本系統實現了完整的預約狀態管理功能，包括四種狀態：待就診(PENDING)、已完成(COMPLETED)、已取消(CANCELLED)、未到診(NO_SHOW)。

## 預約狀態
- **PENDING**: 待就診 - 預約已確認，等待就診
- **COMPLETED**: 已完成 - 就診已完成
- **CANCELLED**: 已取消 - 預約已被取消
- **NO_SHOW**: 未到診 - 患者未按時到診

## API 端點

### 預約管理
- `GET /api/appointments` - 獲取預約列表
- `DELETE /api/appointments/[id]` - 取消預約
- `PUT /api/appointments/status` - 更新預約狀態
- `POST /api/appointments/status` - 自動更新過期預約狀態

### 狀態更新參數
```json
{
  "appointmentId": "string",
  "status": "PENDING|COMPLETED|CANCELLED|NO_SHOW",
  "reason": "string (可選)"
}
```

## 自動化任務

### 定時更新過期預約
- **腳本**: `scripts/update-appointment-status.js`
- **調度器**: `scripts/scheduler.js`
- **頻率**: 每小時執行一次
- **功能**: 自動將過期的 PENDING 預約更新為 COMPLETED 狀態

### 運行命令
```bash
# 手動更新過期預約
npm run update-appointments

# 啟動定時任務調度器
npm run scheduler
```

## 前端功能

### 醫生端 (`/doctor/appointments`)
- ✅ 顯示預約狀態（PENDING、COMPLETED、CANCELLED、NO_SHOW）
- ✅ 顯示狀態變更原因
- ✅ 取消預約按鈕（僅對 PENDING 狀態顯示）
- ✅ 標記爽約按鈕（僅對 COMPLETED 狀態顯示）
- ✅ 狀態篩選器（支援所有四種狀態）

### 患者端 (`/my-appointments`)
- ✅ 顯示預約狀態
- ✅ 顯示狀態變更原因
- ✅ 取消預約按鈕（僅對 PENDING 狀態顯示）
- ✅ 狀態翻譯（中文顯示）

## 信用評分系統
- **取消預約**: -2 分
- **未到診**: -5 分
- **正常就診**: +1 分
- **暫停閾值**: 信用分數 ≤ 0 時暫停預約功能

## 審計日誌
所有狀態變更都會記錄到審計日誌中，包括：
- 操作用戶
- 操作類型
- 變更詳情
- 時間戳

## 數據庫變更

### 新增字段
- `Appointment.reason` - 狀態變更原因
- `Appointment.status` - 使用 AppointmentStatus 枚舉

### Prisma 遷移
```bash
npx prisma migrate dev --name add_appointment_status_and_reason
```

## 測試驗證

### 已完成測試
- ✅ 定時任務調度器正常運行
- ✅ 前端頁面正確顯示新狀態系統
- ✅ API 權限檢查正常工作
- ✅ 預約狀態更新功能正常
- ✅ 數據庫遷移成功

### 測試腳本
- `scripts/check-db-status.js` - 檢查數據庫狀態
- `scripts/create-test-appointment.js` - 創建測試預約
- `scripts/test-appointment-actions.js` - 測試 API 功能
- `scripts/check-appointment-status.js` - 檢查特定預約狀態

## 部署說明

### 生產環境部署
1. 運行數據庫遷移：`npx prisma migrate deploy`
2. 重新生成 Prisma 客戶端：`npx prisma generate`
3. 啟動定時任務調度器：`npm run scheduler`
4. 部署應用程序

### 監控建議
- 監控定時任務執行日誌
- 定期檢查信用評分系統運行狀況
- 監控 API 響應時間和錯誤率

## 系統架構

### 狀態流轉圖
```
PENDING → COMPLETED (自動/手動)
PENDING → CANCELLED (手動取消)
PENDING → NO_SHOW (手動標記)
COMPLETED → NO_SHOW (醫生標記)
```

### 權限控制
- **醫生**: 可以更新所有預約狀態
- **患者**: 只能取消自己的 PENDING 預約
- **管理員**: 擁有所有權限

## 完成狀態
✅ **系統已完全實現並測試通過**

所有核心功能已實現：
- 預約狀態管理
- 自動化任務
- 前端界面更新
- API 端點
- 權限控制
- 信用評分系統
- 審計日誌
- 數據庫遷移