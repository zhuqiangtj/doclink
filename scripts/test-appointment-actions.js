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
console.log('开始测试预约操作...');
    
// 1. 测试取消预约 (DELETE)
console.log('\n1. 测试取消预约...');
    const cancelResult = await makeRequest('http://localhost:3000/api/appointments/cmhhlvgxm0003lh8cn5jcxowh', {
      method: 'DELETE'
    });
console.log('取消预约结果:', cancelResult);
    
// 2. 测试更新预约状态为 NO_SHOW
console.log('\n2. 测试标记爽约...');
    const noShowResult = await makeRequest('http://localhost:3000/api/appointments/status', {
      method: 'PUT',
      body: {
        appointmentId: 'cmhhlvgxm0003lh8cn5jcxowh',
        status: 'NO_SHOW',
        reason: '患者未到診'
      }
    });
console.log('标记爽约结果:', noShowResult);
    
// 3. 测试更新预约状态为 COMPLETED
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
console.error('测试预约操作时发生错误:', error);
  }
}

testAppointmentActions();