// test_conversation_fix.js - Test script for fixed route

// Configuration
const PROJECT_ID = '3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd';
const CONVERSATION_ID = '6ee86b54-a1c7-4f29-a778-ef38233f87d7';
const BASE_URL = 'http://localhost:8000';

// Utility function for making POST requests
async function postData(url = '', data = {}) {
  // Default options are marked with *
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  
  return {
    status: response.status,
    data: await response.json()
  };
}

// Test the exact route that was failing
async function testRouteFixed() {
  console.log('Testing fixed route...');
  
  try {
    // Test the exact endpoint that was failing before
    const url = `${BASE_URL}/api/chat/projects/${PROJECT_ID}/conversations/${CONVERSATION_ID}/messages`;
    console.log(`Sending POST request to: ${url}`);
    
    const result = await postData(url, {
      content: 'Test message after fix',
      role: 'user'
    });
    
    console.log('Response status:', result.status);
    
    // We expect a 401 error instead of a 404, which means the route exists but needs authentication
    if (result.status === 401) {
      console.log('✅ SUCCESS: Route fixed! Now returning 401 (auth required) instead of 404 (not found).');
      console.log('This confirms the API route is working correctly and just needs authentication.');
    } else if (result.status === 201 || result.status === 200) {
      console.log('✅ SUCCESS: The route is working properly now and accepting requests!');
    } else if (result.status === 404) {
      console.log('❌ FAILED: The route is still returning 404 Not Found.');
      console.log('Response data:', result.data);
    } else {
      console.log(`⚠️ Unexpected status code: ${result.status}`);
      console.log('Response data:', result.data);
    }
  } catch (error) {
    console.error('Error testing route:', error);
  }
}

// Run the test
testRouteFixed();
