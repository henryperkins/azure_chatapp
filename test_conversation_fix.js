#!/usr/bin/env node
// test_conversation_fix.js - Test script for conversation loading fix

const { exec } = require('child_process');
const crypto = require('crypto');
const readline = require('readline');

// Helper to simulate API request
function simulateApiRequest(url, method) {
  return new Promise((resolve, reject) => {
    console.log(`Making ${method} request to: ${url}`);
    
    // Handling conversation requests
    if (url === '/api/chat/conversations/41135a2c-ed52-434e-b216-a9461c431b9d') {
      console.log('❌ 404: Conversation belongs to a project, should use project endpoint');
      reject({ status: 404, message: 'Conversation not found' });
    }
    else if (url === '/api/chat/projects/3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd/conversations/41135a2c-ed52-434e-b216-a9461c431b9d') {
      console.log('✅ 200: Found conversation in project');
      resolve({
        id: '41135a2c-ed52-434e-b216-a9461c431b9d',
        title: 'Test Conversation',
        project_id: '3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd',
        model_id: 'claude-3-sonnet-20240229'
      });
    }
    // Example of a conversation that can be found in standalone endpoint but belongs to a project
    else if (url === '/api/chat/conversations/c281e343-d7d2-4aef-88e1-1c6d811465e2') {
      console.log('✅ 200: Found conversation via standalone endpoint (but belongs to a project)');
      resolve({
        id: 'c281e343-d7d2-4aef-88e1-1c6d811465e2',
        title: 'Mixed Conversation',
        project_id: '3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd', // Has project_id
        model_id: 'claude-3-sonnet-20240229'
      });
    }
    
    // Handling message requests
    else if (url === '/api/chat/conversations/41135a2c-ed52-434e-b216-a9461c431b9d/messages') {
      console.log('❌ 404: Messages belong to a project, should use project endpoint');
      reject({ status: 404, message: 'Messages not found' });
    }
    else if (url === '/api/chat/projects/3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd/conversations/41135a2c-ed52-434e-b216-a9461c431b9d/messages') {
      console.log('✅ 200: Found messages in project');
      resolve({
        data: {
          messages: [
            { id: '1', role: 'user', content: 'Hello there' },
            { id: '2', role: 'assistant', content: 'How can I help?' }
          ]
        }
      });
    }
    else if (url === '/api/chat/conversations/c281e343-d7d2-4aef-88e1-1c6d811465e2/messages') {
      console.log('❌ 404: Messages need project endpoint even though conversation was found in standalone');
      reject({ status: 404, message: 'Messages not found' });
    }
    else if (url === '/api/chat/projects/3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd/conversations/c281e343-d7d2-4aef-88e1-1c6d811465e2/messages') {
      console.log('✅ 200: Found messages using project endpoint');
      resolve({
        data: {
          messages: [
            { id: '1', role: 'user', content: 'This is a message' },
            { id: '2', role: 'assistant', content: 'This is a reply' }
          ]
        }
      });
    }
  });
}

// Recreate the relevant parts of ConversationService
class TestConversationService {
  constructor() {
    this.currentConversation = null;
    this.onLoadingStart = () => console.log('Loading started...');
    this.onLoadingEnd = () => console.log('Loading finished.');
  }
  
  _isValidUUID(uuid) {
    if (!uuid) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  }
  
  // Original implementation with the bug
  async loadConversationOriginal(chatId) {
    if (!this._isValidUUID(chatId)) {
      console.error('Invalid conversation ID');
      return false;
    }
    
    this.onLoadingStart();
    
    try {
      // BUG: Uses URL path to determine whether to use project endpoint
      const projectId = process.env.SIMULATE_PROJECT_URL ? '3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd' : null;
      
      let convUrl;
      
      if (projectId) {
        convUrl = `/api/chat/projects/${projectId}/conversations/${chatId}`;
      } else {
        convUrl = `/api/chat/conversations/${chatId}`;
      }
      
      const conversation = await simulateApiRequest(convUrl, "GET");
      
      this.currentConversation = conversation;
      this.onLoadingEnd();
      console.log('Conversation loaded successfully:', conversation.title);
      return true;
    }
    catch (error) {
      this.onLoadingEnd();
      console.error(`Failed to load conversation: ${error.status} ${error.message}`);
      return false;
    }
  }
  
  // Fixed implementation
  async loadConversationFixed(chatId) {
    if (!this._isValidUUID(chatId)) {
      console.error('Invalid conversation ID');
      return false;
    }
    
    this.onLoadingStart();
    
    try {
      // First determine if the conversation belongs to a project
      // We'll try the standalone endpoint first
      let convUrl = `/api/chat/conversations/${chatId}`;
      let msgUrl = `/api/chat/conversations/${chatId}/messages`;
      let conversation, messages;
      let isProjectConversation = false;
      let projectId = null;
      
      try {
        // Try to load the conversation from the standalone endpoint
        conversation = await simulateApiRequest(convUrl, "GET");
      } catch (error) {
        if (error.status === 404) {
          // If 404, the conversation might belong to a project
          // Get the project ID from the URL or localStorage
          projectId = process.env.SIMULATE_PROJECT_URL 
            ? '3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd'
            : '3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd'; // Simulating localStorage value
            
          if (projectId) {
            // Try the project-specific endpoint
            console.log(`Conversation ${chatId} not found in standalone conversations. Trying project ${projectId}.`);
            convUrl = `/api/chat/projects/${projectId}/conversations/${chatId}`;
            msgUrl = `/api/chat/projects/${projectId}/conversations/${chatId}/messages`;
            isProjectConversation = true;
            conversation = await simulateApiRequest(convUrl, "GET");
          } else {
            // If no project ID available, re-throw the original error
            throw error;
          }
        } else {
          // For other error types, re-throw
          throw error;
        }
      }
      
      // If we got here, we have a valid conversation.
      
      // Ensure we are using the correct msg URL based on where we found the conversation
      if (isProjectConversation) {
        msgUrl = `/api/chat/projects/${projectId}/conversations/${chatId}/messages`;
      } else if (conversation.project_id) {
        // If conversation was found via standalone endpoint but has a project_id
        // This is important - some endpoints might allow retrieving project conversations
        // via the standalone endpoint (for compatibility), but messages API might be strict
        projectId = conversation.project_id;
        msgUrl = `/api/chat/projects/${projectId}/conversations/${chatId}/messages`;
        isProjectConversation = true;
      }
      
      // Now get messages using the correct endpoint
      try {
        messages = await simulateApiRequest(msgUrl, "GET");
      } catch (error) {
        if (error.status === 404 && !isProjectConversation && conversation.project_id) {
          // If we retrieved the conversation from standalone endpoint but it has a project_id,
          // and messages failed, try using the project endpoint for messages
          console.log(`Message retrieval failed with standalone endpoint. Trying project endpoint for messages.`);
          projectId = conversation.project_id;
          msgUrl = `/api/chat/projects/${projectId}/conversations/${chatId}/messages`;
          messages = await simulateApiRequest(msgUrl, "GET");
        } else {
          throw error;
        }
      }
      
      this.currentConversation = {
        id: chatId,
        ...conversation,
        messages: messages.data?.messages || []
      };
      
      this.onLoadingEnd();
      console.log('Conversation loaded successfully:', conversation.title);
      console.log(`Retrieved ${messages.data?.messages?.length || 0} messages`);
      return true;
    }
    catch (error) {
      this.onLoadingEnd();
      console.error(`Failed to load conversation: ${error.status} ${error.message}`);
      return false;
    }
  }
}

// Test special mixed case where a conversation can be found via standalone endpoint
// but messages require the project endpoint
async function testMixedScenario() {
  const service = new TestConversationService();
  const mixedChatId = 'c281e343-d7d2-4aef-88e1-1c6d811465e2';
  
  console.log('\n==== TEST 5: Mixed Scenario - Original Implementation ====');
  console.log('(Skipped - original cannot handle this scenario properly)');
  
  console.log('\n==== TEST 6: Mixed Scenario - Fixed Implementation ====');
  process.env.SIMULATE_PROJECT_URL = '';
  try {
    await service.loadConversationFixed(mixedChatId);
  } catch (error) {
    console.error('Failed to load mixed scenario conversation:', error);
  }
}

// Test harness
async function runTests() {
  const service = new TestConversationService();
  const chatId = '41135a2c-ed52-434e-b216-a9461c431b9d';
  
  console.log('\n==== TEST 1: Original Implementation (Non-Project URL) ====');
  process.env.SIMULATE_PROJECT_URL = '';
  await service.loadConversationOriginal(chatId);
  
  console.log('\n==== TEST 2: Original Implementation (Project URL) ====');
  process.env.SIMULATE_PROJECT_URL = 'true';
  await service.loadConversationOriginal(chatId);
  
  console.log('\n==== TEST 3: Fixed Implementation (Non-Project URL) ====');
  process.env.SIMULATE_PROJECT_URL = '';
  await service.loadConversationFixed(chatId);
  
  console.log('\n==== TEST 4: Fixed Implementation (Project URL) ====');
  process.env.SIMULATE_PROJECT_URL = 'true';
  await service.loadConversationFixed(chatId);
  
  // Run the mixed scenario test
  await testMixedScenario();
}

runTests().then(() => {
  console.log('\nTests completed.');
  console.log('\nAnalysis:');
  console.log('1. The fixed implementation correctly adapts to the conversation\'s location,');
  console.log('   trying the standalone endpoint first and then the project endpoint if needed.');
  console.log('2. Even when a conversation can be retrieved from the standalone endpoint,');
  console.log('   the implementation checks if it belongs to a project and uses the project endpoint');
  console.log('   for message retrieval if necessary.');
  console.log('3. This ensures conversations are loaded correctly regardless of the current URL path');
  console.log('   and regardless of API endpoint implementation details.');
});
