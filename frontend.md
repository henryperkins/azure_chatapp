Below are all of the files you need to drop into your frontend/ directory. They assume you’ve got Tailwind via CDN and the backend running at the same origin.

⸻

frontend/index.html

<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link
    href="https://cdn.jsdelivr.net/npm/tailwindcss@3.4.4/dist/tailwind.min.css"
    rel="stylesheet"
  />
  <title>GPT-image-1 + Responses UI</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
</head>
<body class="bg-slate-50 min-h-screen flex flex-col">

  <!-- ── Chat Pane ───────────────────────────────────────────────────────── -->
  <section class="bg-white shadow-sm p-6 rounded space-y-4 mb-6 mx-auto w-full max-w-4xl">
    <h2 class="text-lg font-semibold">💬 Chat (Responses API)</h2>
    <div
      id="chatLog"
      class="h-64 overflow-y-auto border rounded p-3 text-sm bg-slate-50"
    ></div>
    <form id="chatForm" class="flex gap-2">
      <input
        id="chatInput"
        required
        class="flex-1 border rounded p-2"
        placeholder="Type a message…"
      />
      <button class="bg-indigo-600 text-white px-4 rounded">Send</button>
    </form>
  </section>

  <!-- ── Image Generation + Editing ───────────────────────────────────────── -->
  <main class="flex-1 container mx-auto p-4 space-y-6 max-w-4xl">
    <!-- Generate Form -->
    <form id="genForm" class="bg-white shadow-sm p-6 rounded space-y-4">
      <h2 class="text-lg font-semibold">🖼️ Generate Image</h2>
      <div>
        <label class="block font-medium mb-1">Prompt</label>
        <textarea
          id="prompt"
          required
          rows="3"
          class="w-full border rounded p-2"
        ></textarea>
      </div>
      <div class="grid md:grid-cols-3 gap-4">
        <div>
          <label class="block font-medium mb-1">Size</label>
          <select id="size" class="w-full border rounded p-2">
            <option>1024x1024</option>
            <option>1024x1536</option>
            <option>1536x1024</option>
          </select>
        </div>
        <div>
          <label class="block font-medium mb-1">Quality</label>
          <select id="quality" class="w-full border rounded p-2">
            <option>high</option>
            <option>medium</option>
            <option>low</option>
          </select>
        </div>
        <div>
          <label class="block font-medium mb-1">Images (n)</label>
          <input
            id="n"
            type="number"
            min="1"
            max="10"
            value="1"
            class="w-full border rounded p-2"
          />
        </div>
      </div>
      <button
        type="submit"
        class="bg-indigo-600 text-white px-4 py-2 rounded"
      >
        Generate
      </button>
    </form>

    <!-- Edit Form -->
    <form id="editForm" class="bg-white shadow-sm p-6 rounded space-y-4">
      <h2 class="text-lg font-semibold">✏️ Edit / In-paint</h2>
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="block font-medium mb-1">Original image</label>
          <input
            id="orig"
            type="file"
            accept="image/*"
            required
            class="w-full"
          />
        </div>
        <div>
          <label class="block font-medium mb-1">Mask (optional)</label>
          <input
            id="mask"
            type="file"
            accept="image/png"
            class="w-full"
          />
          <p class="text-xs text-slate-500">
            Leave blank to edit the whole image.
          </p>
        </div>
      </div>
      <div>
        <label class="block font-medium mb-1">Edit prompt</label>
        <input
          id="editPrompt"
          type="text"
          required
          class="w-full border rounded p-2"
        />
      </div>
      <div class="grid md:grid-cols-3 gap-4">
        <div>
          <label class="block font-medium mb-1">Size</label>
          <select id="esize" class="w-full border rounded p-2">
            <option>1024x1024</option>
            <option>1024x1536</option>
            <option>1536x1024</option>
          </select>
        </div>
        <div>
          <label class="block font-medium mb-1">Quality</label>
          <select id="equality" class="w-full border rounded p-2">
            <option>high</option>
            <option>medium</option>
            <option>low</option>
          </select>
        </div>
      </div>
      <button
        type="submit"
        class="bg-emerald-600 text-white px-4 py-2 rounded"
      >
        Edit Image
      </button>
    </form>

    <!-- Results -->
    <section id="results" class="grid gap-4 md:grid-cols-3"></section>
  </main>

  <script src="chat.js"></script>
  <script src="app.js"></script>
</body>
</html>



⸻

frontend/app.js

// Image generation & editing logic
const genForm = document.getElementById("genForm");
const editForm = document.getElementById("editForm");
const results = document.getElementById("results");

// ── Generate Handler ────────────────────────────────────────────────────────
genForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  results.innerHTML = "";
  const btn = genForm.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Generating…";

  const fd = new FormData(genForm);
  const resp = await fetch("/api/generate", { method: "POST", body: fd });

  btn.disabled = false;
  btn.textContent = "Generate";

  if (!resp.ok) {
    alert("Error: " + (await resp.text()));
    return;
  }

  const { images } = await resp.json();
  images.forEach(({ filename, b64 }) => {
    const url = `data:image/png;base64,${b64}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.className = "block border rounded overflow-hidden shadow-sm";
    const img = document.createElement("img");
    img.src = url;
    img.alt = filename;
    link.appendChild(img);
    results.appendChild(link);
  });
});

// ── Edit Handler ───────────────────────────────────────────────────────────
editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  results.innerHTML = "";
  const btn = editForm.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Editing…";

  const fd = new FormData();
  fd.append("image", document.getElementById("orig").files[0]);
  const maskFile = document.getElementById("mask").files[0];
  if (maskFile) fd.append("mask", maskFile);
  fd.append("prompt", document.getElementById("editPrompt").value);
  fd.append("size", document.getElementById("esize").value);
  fd.append("quality", document.getElementById("equality").value);

  const resp = await fetch("/api/edit", { method: "POST", body: fd });

  btn.disabled = false;
  btn.textContent = "Edit Image";

  if (!resp.ok) {
    alert("Error: " + (await resp.text()));
    return;
  }

  const { image } = await resp.json();
  const url = `data:image/png;base64,${image.b64}`;
  const link = document.createElement("a");
  link.href = url;
  link.download = image.filename;
  link.className = "block border rounded overflow-hidden shadow-sm";
  const img = document.createElement("img");
  img.src = url;
  img.alt = image.filename;
  link.appendChild(img);
  results.appendChild(link);
});



⸻

frontend/chat.js

// Chat (Responses API) logic
const chatLog   = document.getElementById("chatLog");
const chatForm  = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

let conversationId = null;
let source         = null;

function append(role, text) {
  const div = document.createElement("div");
  div.innerHTML = `<span class="font-bold">${role}:</span> ${text.replaceAll('\n','<br>')}`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  append("You", text);
  chatInput.value = "";
  chatInput.focus();

  if (source) source.close();

  const payload = { text, conversation_id: conversationId, stream: true };
  source = new EventSource("/api/chat", {
    withCredentials: false,
    headers: { "Content-Type": "application/json" },
    payload: JSON.stringify(payload)
  });

  let assistantBuf = "";
  append("Assistant", "…");

  source.addEventListener("message", (ev) => {
    assistantBuf += ev.data;
    chatLog.lastChild.innerHTML =
      `<span class="font-bold">Assistant:</span> ${assistantBuf.replaceAll('\n','<br>')}`;
  });

  source.addEventListener("done", () => source.close());
  source.addEventListener("error", (err) => { console.error(err); source.close(); });
  source.addEventListener("open", () => {
    // grab server-issued convo ID from URL if provided
    const url = source.url;
    const m = url.match(/conversation_id=([^&]+)/);
    if (m) conversationId = m[1];
  });
});



⸻

frontend/favicon.svg

A minimal placeholder—swap in your own logo if you like:

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="10" fill="#4F46E5"/>
  <text x="12" y="16" font-size="12" text-anchor="middle" fill="#FFF">GPT</text>
</svg>



⸻

With these in place, docker-compose up (or uvicorn main:app) will serve a single-page app that:
	1.	Streams stateful chat via the Responses API.
	2.	Generates & edits images with GPT-image-1.

Enjoy!