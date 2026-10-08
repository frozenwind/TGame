mergeInto(LibraryManager.library, {
  TodSocketCreate: function (urlPtr) {
    var url = UTF8ToString(urlPtr);
    if (!window.__tod) window.__tod = { socket: null, queue: [] };
    if (window.__tod.socket) {
      try { window.__tod.socket.close(); } catch (error) {}
    }
    var socket = new WebSocket(url);
    window.__tod.socket = socket;
    window.__tod.queue = [];
    socket.onopen = function () { window.__tod.queue.push("\u0001open"); };
    socket.onclose = function () { window.__tod.queue.push("\u0001close"); };
    socket.onerror = function () { window.__tod.queue.push("\u0001error"); };
    socket.onmessage = function (event) { window.__tod.queue.push(String(event.data)); };
  },
  TodSocketSend: function (messagePtr) {
    var message = UTF8ToString(messagePtr);
    var socket = window.__tod && window.__tod.socket;
    if (socket && socket.readyState === 1) socket.send(message);
  },
  TodSocketClose: function () {
    if (window.__tod && window.__tod.socket) window.__tod.socket.close();
  },
  TodSocketPoll: function (buffer, bufferSize) {
    if (!window.__tod || !window.__tod.queue.length) return 0;
    var message = window.__tod.queue.shift();
    stringToUTF8(message, buffer, bufferSize);
    return 1;
  }
});
