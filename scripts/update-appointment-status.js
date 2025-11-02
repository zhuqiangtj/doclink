/**
 * 定時任務：自動更新過期預約狀態
 * 將超過預約時間的 PENDING 狀態預約自動更新為 COMPLETED
 */

const https = require('https');
const http = require('http');

function makeRequest(url, options) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    
    const req = protocol.request(url, options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: () => jsonData });
        } catch (error) {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: data });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

async function updateExpiredAppointments() {
  try {
    console.log('開始更新過期預約狀態...');
    
    const response = await makeRequest('http://localhost:3000/api/appointments/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = response.json ? response.json() : JSON.parse(response.text);
    console.log('更新結果:', result);
    
    if (result.updatedCount > 0) {
      console.log(`成功更新了 ${result.updatedCount} 個過期預約的狀態`);
    } else {
      console.log('沒有需要更新的過期預約');
    }
    
  } catch (error) {
    console.error('更新過期預約狀態時發生錯誤:', error);
  }
}

// 如果直接運行此腳本
if (require.main === module) {
  updateExpiredAppointments();
}

module.exports = { updateExpiredAppointments };