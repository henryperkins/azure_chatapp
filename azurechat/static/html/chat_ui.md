```html
<!-- Chat interface container -->
<div id="globalChatContainer" class="mt-4 transition-all duration-300 ease-in-out">
    <div id="globalChatUI" class="bg-base-100 rounded-box shadow-lg border border-base-200 overflow-hidden">
        <div class="chat-title-row flex items-center justify-between py-2 px-4 border-b border-base-200 bg-base-100/60">
            <span id="chatTitle">Current Conversation Title</span>

            <!-- Enhanced input area with better styling -->
            <div class="flex items-center border-t border-base-200 p-3 bg-base-200/30 backdrop-blur-sm">
                <div class="relative flex-1 mr-2">
                    <input id="chatUIInput" type="text"
                        class="w-full input input-bordered rounded-lg pl-10 pr-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary transition-all"
                        placeholder="Type your message...">
                    <svg xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-base-content/50" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                </div>
                <button id="globalChatSendBtn" type="button"
                    class="btn btn-primary rounded-lg px-6 flex items-center gap-2 hover:shadow-md transition-all">
                    <span>Send</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                </button>
            </div>
        </div>
    </div>

```