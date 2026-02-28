#!/usr/bin/env node

/**
 * Quick test script for the AI test endpoint
 */

const https = require('http');

async function test() {
  // Step 1: Login
  console.log('🔐 Logging in...');
  const loginData = JSON.stringify({ username: 'admin', password: 'admin123' });
  
  const loginReq = https.request({
    hostname: 'localhost',
    port: 3001,
    path: '/api/auth/admin/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': loginData.length,
    },
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (!json.token) {
          console.error('❌ No token in response:', json);
          return;
        }
        
        const token = json.token;
        console.log(`✓ Login successful. Token: ${token.substring(0, 50)}...`);
        
        // Step 2: Test AI
        testAI(token);
      } catch (e) {
        console.error('❌ Login failed:', e.message);
      }
    });
  });
  
  loginReq.write(loginData);
  loginReq.end();
}

function testAI(token) {
  console.log('\n🤖 Testing AI endpoint...');
  const prompt = 'Erkläre kurz was eine API ist.';
  const testData = JSON.stringify({ prompt });
  
  const testReq = https.request({
    hostname: 'localhost',
    port: 3001,
    path: '/api/admin/ai/test',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Length': testData.length,
    },
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (res.statusCode !== 200) {
          console.error(`❌ AI test failed (${res.statusCode}):`, json);
          return;
        }
        
        console.log(`\n✓ AI Test successful!`);
        console.log(`  Provider: ${json.provider}`);
        console.log(`  Model: ${json.model}`);
        console.log(`  Prompt: ${json.prompt}`);
        console.log(`  Response: ${json.response.substring(0, 150)}...`);
      } catch (e) {
        console.error('❌ AI test error:', e.message);
      }
    });
  });
  
  testReq.write(testData);
  testReq.end();
}

test();
