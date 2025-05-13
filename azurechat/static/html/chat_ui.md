```html
<!-- Chat interface container -->
<div id="globalChatContainer" class="mt-4 transition-all duration-300 ease-in-out">
    <div class="flex justify-between items-center mb-2">
        <h3 class="font-medium text-lg">Conversation</h3>
        <button id="minimizeChatBtn" type="button" class="text-gray-500 hover:text-gray-700 p-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18
              6M6 6l12 12" />
            </svg>
        </button>
    </div>
    <div id="globalChatUI" class="bg-base-100 rounded-box shadow-md border border-base-200">
        <div id="globalChatMessages" class="chat-message-container"></div>
        <div class="flex items-center border-t border-base-200 p-2">
            <input id="chatUIInput" type="text"
                class="flex-1 input input-bordered rounded-l-sm"
                placeholder="Type your message...">
            <button id="globalChatSendBtn" type="button"
                class="btn btn-primary rounded-r-sm rounded-l-none">
                Send
            </button>
        </div>
    </div>
</div>

```