/**
 * 定时任务：自动更新过期预约状态
 * 将超过预约时间的 PENDING 状态预约自动更新为 COMPLETED
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
console.log('开始更新过期预约状态...');
    
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
console.log(`成功更新了 ${result.updatedCount} 个过期预约的状态`);
    } else {
console.log('没有需要更新的过期预约');
    }
    
  } catch (error) {
console.error('更新过期预约状态时发生错误:', error);
  }
}

// 如果直接運行此腳本
if (require.main === module) {
  updateExpiredAppointments();
}

module.exports = { updateExpiredAppointments };