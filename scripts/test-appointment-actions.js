const http = require('http');
const https = require('https');

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };
    
    const req = client.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    
    req.end();
  });
}

async function testAppointmentActions() {
  try {
    console.log('開始測試預約操作...');
    
    // 1. 測試取消預約 (DELETE)
    console.log('\n1. 測試取消預約...');
    const cancelResult = await makeRequest('http://localhost:3000/api/appointments/cmhhlvgxm0003lh8cn5jcxowh', {
      method: 'DELETE'
    });
    console.log('取消預約結果:', cancelResult);
    
    // 2. 測試更新預約狀態為 NO_SHOW
    console.log('\n2. 測試標記爽約...');
    const noShowResult = await makeRequest('http://localhost:3000/api/appointments/status', {
      method: 'PUT',
      body: {
        appointmentId: 'cmhhlvgxm0003lh8cn5jcxowh',
        status: 'NO_SHOW',
        reason: '患者未到診'
      }
    });
    console.log('標記爽約結果:', noShowResult);
    
    // 3. 測試更新預約狀態為 COMPLETED
    console.log('\n3. 測試標記完成...');
    const completedResult = await makeRequest('http://localhost:3000/api/appointments/status', {
      method: 'PUT',
      body: {
        appointmentId: 'cmhhlvgxm0003lh8cn5jcxowh',
        status: 'COMPLETED',
        reason: '正常完成就診'
      }
    });
    console.log('標記完成結果:', completedResult);
    
  } catch (error) {
    console.error('測試預約操作時發生錯誤:', error);
  }
}

testAppointmentActions();