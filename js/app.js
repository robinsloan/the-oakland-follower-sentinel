var Client = {};

// NOTE THAT web crypto libraries aren't available in local network,
// non-localhost environments. For the sake of future debugging.

Client.DEV = false;

// Rather than create them every time I need them:
Client.encoder = new TextEncoder();
Client.parser = new DOMParser();

Client.sources = {};
Client.boardTimestamps = {};
Client.hypocorisms = {};

Client.DEV_ACCELERATOR = 1.0; // 1.0
Client.BASE_TIMEOUT_SECONDS = 60*5*Client.DEV_ACCELERATOR;
Client.MAX_TIMEOUT_SECONDS = 60*60*24*Client.DEV_ACCELERATOR;

Client.KEY_REGEX = /\/([0-9a-f]{64})\/?$/;
Client.SPRING_URL_REGEX = /http.+\/[0-9a-f]{64}\/?/;

Client.FEED_PROXY = "https://us-west1-spring-83.cloudfunctions.net/feed-proxy";

Client.setupEditor = async function() {
  Client.editor = ace.edit("editor");
  Client.editor.setTheme("ace/theme/spring_client");
  Client.editor.session.setMode("ace/mode/html");

  // All options are listed here:
  // https://github.com/ajaxorg/ace/wiki/Configuring-Ace
  Client.editor.setOptions({
    fontFamily: "JetBrains Mono",
    fontSize: "1.25rem",
    behavioursEnabled: false,
    enableBasicAutocompletion: false,
    enableLiveAutocompletion: false,
    enableAutoIndent: true,
    showLineNumbers: false,
    showPrintMargin: false,
    showFoldWidgets: false,
    showGutter: false,
    indentedSoftWrap: false,
    useWorker: false,
    wrap: true,
    tabSize: 2,
  });

  Client.editor.session.on("change", async function(delta) {
    Client.handleEditorChange();
  });

  // Set up Markdown parser
  marked.setOptions({
    headerIds: false,
    smartypants: true,
    mangle: false
  });

  Client.loadEditorHTML();
}

Client.setup = async function() {
  Client.setupEditor();

  // -- Global element handles --

  Client.main = document.querySelector("main");

  Client.previewModal = document.querySelector("preview-modal");
  Client.boardPreview = document.querySelector("board-preview");

  Client.homeServerSelect = document.querySelector("server-zone select#home-server");
  Client.backupServerSelect = document.querySelector("server-zone select#backup-server");

  const homeServerSaved = Client.getHomeServer();
  if (!homeServerSaved) {
    localStorage.setItem("home-server", "https://bogbody.biz/");
    Client.getHomeServer.value = Client.getHomeServer();
  } else {
    Client.homeServerSelect.value = homeServerSaved;
  }

  const backupServerSaved = Client.getBackupServer();
  if (!backupServerSaved) {
    localStorage.setItem("backup-server", "https://spring83.kindrobot.ca/");
    Client.backupServerSelect.value = Client.getBackupServer();
  } else {
    Client.backupServerSelect.value = backupServerSaved;
  }

  Client.springURLDisplay = document.querySelector("editor-zone input#spring-url");

  Client.byteCounter = document.querySelector("editor-zone byte-counter");
  Client.publishButton = document.querySelector("editor-zone publish-button");

  Client.springfileModal = document.querySelector("springfile-modal");
  Client.springfileEditor = Client.springfileModal.querySelector("textarea");

  Client.dropZone = document.querySelector("drop-zone");
  Client.fileUpload = Client.dropZone.querySelector("input#keypair-upload");

  Client.itemGrid = document.querySelector("item-grid");

  Client.showingSpringFileEditor = false;
  Client.showingBoardPreview = false;
  Client.okayToPublish = true;

  // -- Intersection observer --

  const intOptions = {
    threshold: 0.8
  }

  Client.observer = new IntersectionObserver(Client.intersect, intOptions);

  // -- Drop zone --

  Client.dropZone.addEventListener("drop", (e) => {
    e.preventDefault(); // don't open the file!
    e.stopPropagation();

    let file = e.dataTransfer.files[0];
    let reader = new FileReader();
    reader.addEventListener("load", (f) => {
      const fileString = f.target.result;
      Client.loadKeypairFromString(fileString);
    });

    reader.readAsText(file);
  });

  Client.dropZone.addEventListener("dragenter", (e) => {
    e.preventDefault(); // don't open the file!
    e.stopPropagation();
    Client.dropZone.classList.add("drop-glow");
  });

  Client.dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault(); // don't open the file!
    e.stopPropagation();
    Client.dropZone.classList.remove("drop-glow");
  });

  Client.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault(); // don't open the file!
    e.stopPropagation();
  });

  // -- File upload, alternative to drop --

  Client.fileUpload.addEventListener("change", (e) => {
    let file = e.target.files[0];
    if (file) {
      let reader = new FileReader();
      reader.addEventListener("load", (f) => {
        const fileString = f.target.result;
        Client.loadKeypairFromString(fileString);
      });

      reader.readAsText(file);
    }
  });

  // -- Server select --

  Client.homeServerSelect.addEventListener("change", (e) => {
    localStorage.setItem("home-server", Client.homeServerSelect.value);
    console.log(`Registered home server: ${Client.homeServerSelect.value}`)
    Client.updateSpringURLDisplay();
  });

  Client.backupServerSelect.addEventListener("change", (e) => {
    localStorage.setItem("backup-server", Client.backupServerSelect.value);
    console.log(`Registered backup server: ${Client.backupServerSelect.value}`)
  });

  // -- Publish button --

 Client.publishButton.addEventListener("click", (e) => {
    if (Client.okayToPublish) {
      Client.publishButton.innerHTML = "Publishing&hellip;";
      Client.publishBoard();
    }
  });

 // -- Springfile modal --

  // When you're viewing the Springfile modal and you click outside the textarea, it closes
  Client.springfileModal.addEventListener("mousedown", (e) => {
    if (e.target.tagName.toLowerCase() == "springfile-modal") {
      Client.hideSpringfileEditor();
    }
  });

  // just copying and pasting for now! Sorryyyy
  Client.springfileModal.addEventListener("touchstart", (e) => {
    if (e.target.tagName.toLowerCase() == "springfile-modal") {
      Client.hideSpringfileEditor();
    }
  });

  // Likewise, when you're viewing a board preview

  // When you're viewing the board previee and you click outside, it closes
  Client.previewModal.addEventListener("mousedown", (e) => {
    if (e.target.tagName.toLowerCase() == "preview-modal") {
      Client.hideBoardPreview();
    }
  });

  // just copying and pasting for now! Sorryyyy
  Client.previewModal.addEventListener("touchstart", (e) => {
    if (e.target.tagName.toLowerCase() == "preview-modal") {
      Client.hideBoardPreview();
    }
  });

  // -- Spring URL display field behavior --

  Client.springURLDisplay.addEventListener("click", (e) => {
    e.target.setSelectionRange(0, e.target.value.length);
  });

  // -- Keyboard shortcuts --

  // Escape key shortcut to show/hide Springfile editor
  document.addEventListener("keydown", (e) => {
    if (e.code == "Escape") {
      if (Client.showingBoardPreview) {
        Client.hideBoardPreview();
      }
      Client.toggleSpringfileEditor();
      e.preventDefault();
    }
  });

  // Cmd-shift-P key shortcut to show/hide publish panel
  document.addEventListener("keydown", (e) => {
    if (e.code == "KeyP") {
      if (e.shiftKey && e.metaKey) {
        Client.main.classList.toggle("minimized");
      }
    }
  });

  // -- Link click handling, which does several important things

  // https://stackoverflow.com/questions/12235585/is-there-a-way-to-open-all-a-href-links-on-a-page-in-new-windows
  document.body.addEventListener("click", (e) => {
    // composedPath, weeeird
    // https://pm.dartus.fr/blog/a-complete-guide-on-shadow-dom-and-event-propagation/
    const clickedElement = e.composedPath()[0];
    if (clickedElement.nodeName.toUpperCase() === "A") {
      clickedElement.target = "_blank";
      if (clickedElement.href.match(Client.SPRING_URL_REGEX)) {
        Client.previewBoardAtURL(clickedElement.href);
        e.preventDefault();
      }
    }
  }, true);

  // -- Action buttons --

  document.querySelectorAll(".action").forEach((element) => {
    element.addEventListener("click", (e) => {
      if (element.classList.contains("dangerous")) {
        if (e.shiftKey && e.metaKey) {
          // you may pass
        } else {
          alert("That's a dangerous action. If you're 100% sure, hold the command and shift keys while clicking the button again.");
          e.preventDefault();
          return;
        }
      }

      if (element.classList.contains("edit-springfile")) {
        Client.showSpringfileEditor();
      }

      if (element.classList.contains("save-keypair")) {
        Client.saveKeypairFile();
      }

      if (element.classList.contains("forget-keypair")) {
        Client.forgetKeypair();
      }

      if (element.classList.contains("force-refresh")) {
        Client.checkSources(true);
      }

      if (element.classList.contains("factory-reset")) {
        Client.factoryReset();
      }
    });
  });

  // -- Keypair setup --

  const secret = Client.getSecretKey();
  const public = Client.getPublicKey();
  if (secret && public) {
    Client.hideDropZone();
    Client.updateSpringURLDisplay();
  }

  // -- Boot it up --

  let springfileContent = localStorage.getItem("springfile");
  if (springfileContent) {
    Client.springfileEditor.value = springfileContent;
  } else {
    Client.springfileEditor.value = STARTER_SPRINGFILE;
  }

  if (Client.getPublicKey()) {
    await Client.pullSpringfile();
  }

  Client.parseSpringfile();
  Client.reloadItemGrid(true) // force;

  // No need to do this, because it happens automatically with reloadItemGrid:
  // Client.checkSources(true); // force;
  setInterval(Client.checkSources, 1000*60);
}

document.addEventListener("DOMContentLoaded", (e) => {
  Client.setup();
});

// -- Utility --

Client.factoryReset = async function() {
  Client.forgetKeypair();
  localStorage.clear();
  location.reload();
}

Client.lastModifiedInHTML = async function(html) {
  let boardElement = await Client.parser.parseFromString(html, "text/html");
  let timeElement = boardElement.querySelector("time");
  let timestamp = timeElement.getAttribute("datetime");
  if (timeElement && timestamp) {
    // TODO: validate this actually an ISO 8601 timestamp! duh!
    return new Date(timestamp);
  } else {
    return null;
  }
}

// -- Intersection, "un-highlighting" fresh items --

Client.intersect = function(entries, observer) {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.remove("refreshed");
    } else {
      // not a dang thing
    }
  });
}

// -- Keypair stuff --

Client.showDropZone = async function() {
  Client.dropZone.style.display = "flex";
}

Client.hideDropZone = async function() {
  Client.dropZone.style.display = "none";
}

Client.loadKeypairFromString = async function(fileString) {
  const secret = fileString.slice(0, 64).trim();
  const public = fileString.slice(64, 128).trim();

  try {
    // let's make sure it's a real Ed25519 keypair
    const testMessage = "hello, world";
    const testMessageBytes = Client.encoder.encode(testMessage);
    const signatureBytes = await nobleEd25519.sign(testMessageBytes, secret);
    const signature = nobleEd25519.utils.bytesToHex(signatureBytes);
    const verified = await nobleEd25519.verify(signature, testMessageBytes, public);

    if (!verified) {
      alert("That's not a valid Ed25519 keypair.");
      return;
    }
  } catch (e) {
    console.log(e);
    alert("That's not a valid Ed25519 keypair.");
    return;
  }

  console.log("That's a good keypair");

  localStorage.setItem("secretKey", secret);
  localStorage.setItem("publicKey", public);

  Client.updateSpringURLDisplay();
  Client.hideDropZone();

  // Synchronize with stored Springfile, if we have it
  Client.pullSpringfile();

  // Doing this here to get the new public key included in parseSpringfile()
  Client.parseSpringfile();
  Client.reloadItemGrid();
}

Client.forgetKeypair = async function() {
  localStorage.removeItem("secretKey");
  localStorage.removeItem("publicKey");
  Client.showDropZone();
}

Client.getSecretKey = function() {
  let secret = localStorage.getItem("secretKey");
  if (secret) {
    return secret;
  } else {
    console.log("Tried to get secret key but I don't have one stored.");
    return null;
  }
}

Client.getPublicKey = function() {
  let public = localStorage.getItem("publicKey");
  if (public) {
    return public;
  } else {
    console.log("Tried to get public key but I don't have one stored.");
    return null;
  }
}

Client.saveKeypairFile = function() {
  const secret = Client.getSecretKey();
  const public = Client.getPublicKey();
  if (secret == null || public == null) {
    console.log("Tried to save keypair without keypair in storage")
    return;
  }
  const keyString = `${secret}${public}`;
  const memo = public.slice(0, 12);
  // Just the 20XX-XX-XX part of the Date:
  const timestamp = (new Date()).toISOString().slice(0, 10);
  const downloader = document.createElement("a");
  const file = new Blob([keyString], { type: "text/plain;charset=utf-8" });
  downloader.href = URL.createObjectURL(file);
  downloader.download = `spring-83-keypair-${timestamp}-${memo}.txt`;
  downloader.click();
}

// -- Servers --

Client.getHomeServer = function() {
  const home = localStorage.getItem("home-server");
  if (home === null) {
    console.log("error getting home server...");
  }
  return home;
}

Client.getBackupServer = function() {
  const backup = localStorage.getItem("backup-server");

  if (backup === null) {
    console.log("error getting backup server...");
  }

  return backup;
}

// -- Spring URL --

Client.updateSpringURLDisplay = function() {
  const url = Client.getHomeServer() + Client.getPublicKey();
  Client.springURLDisplay.value = url;
}

// -- Preview a board, FUN --

Client.previewBoardAtURL = async function(url) {
  // This definitely has a lot of duplicated code from other functions
  // Alas

  const keyMatch = url.match(Client.KEY_REGEX);
  if (keyMatch === null) {
    console.log("Not a Spring 83 URL!");
    return;
  }

  const key = keyMatch[1];

  let template = document.querySelector("template#board-preview-template");
  let boardDisplay = template.content.cloneNode(true);
  // I find it confusing that I still have to query into the board-item here:
  let boardItem = boardDisplay.querySelector("board-item");

  let boardArea = boardItem.querySelector("board-area");

  let boardURLDisplay = boardItem.querySelector("input");
  boardURLDisplay.value = url;
  boardURLDisplay.addEventListener("click", (e) => {
    e.target.setSelectionRange(0, e.target.value.length);
  });

  // CONJURE THE SHADOW DOM, RAHHH
  let boardContent = boardItem.querySelector("board-content");
  boardContent.attachShadow({mode: "open"});

  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      mode: "cors"
    });
  } catch (e) {
    console.log("Error with fetch; server not found? TODO: document.");
    console.log("TODO handle this better.")
    return;
  }

  const signature = response.headers.get("Spring-Signature");
  if (!signature) {
    console.log("Server didn't sign the response.");
    return false;
  }

  const board = await response.text();

  // https://stackoverflow.com/questions/6965107/converting-between-strings-and-arraybuffers
  const boardForVerification = Client.encoder.encode(board);

  const verified = await nobleEd25519.verify(signature, boardForVerification, key);

  if (verified) {
    console.log("Signature verified, how nice.");
  } else {
    console.log("Signature is not correct; dropping");
    return false;
    // TODO mark server as untrustworthy
  }

  boardContent.shadowRoot.innerHTML = DEFAULT_BOARD_CSS + board;

  Client.boardPreview.innerHTML = "";
  Client.boardPreview.append(boardItem);
  Client.showBoardPreview();
}

// -- Board preview modal behavior --

Client.showBoardPreview = function() {
  Client.previewModal.style.display = "flex";
  Client.showingBoardPreview = true;
}

Client.hideBoardPreview = function() {
  Client.previewModal.style.display = "none";
  Client.showingBoardPreview = false;
}

// -- Springfile editor behavior --

Client.showSpringfileEditor = function() {
  Client.pullSpringfile(); // async, so it might complete a bit "late", fine

  // note .parentElement, for springfile-modal
  Client.springfileEditor.parentElement.style.display = "block";
  Client.showingSpringFileEditor = true;
  Client.springfileEditor.focus();
  Client.springfileEditor.scrollTop = 0;
}

Client.hideSpringfileEditor = function() {
  // note .parentElement, for springfile-modal
  Client.springfileEditor.parentElement.style.display = "none";
  Client.showingSpringFileEditor = false;
  Client.springfileEditor.blur();

  const existingSpringfile = localStorage.getItem("springfile");
  if (Client.springfileEditor.value !== existingSpringfile) {
    localStorage.setItem("springfile", Client.springfileEditor.value);
    Client.setSpringfileModified(new Date()); // now!
    Client.pushSpringfile();
  }

  // KER-THUNK
  Client.parseSpringfile();
  Client.reloadItemGrid(false); // Don't force checks
}

Client.toggleSpringfileEditor = function() {
  if (Client.showingSpringFileEditor) {
    Client.hideSpringfileEditor();
  } else {
    Client.showSpringfileEditor();
  }
}

// -- Springfile sync --

Client.CONFIG_SYNC = "https://sync.followersentinel.com/"

Client.setShouldSync = function(shouldSync) {
  let stringShouldSync;
  if (shouldSync === true) {
    stringShouldSync = "true";
  } else {
    stringShouldSync = "false";
  }

  localStorage.setItem("should-sync", stringShouldSync);
}

Client.getShouldSync = function() {
  const stringShouldSync = localStorage.getItem("should-sync");
  if (stringShouldSync === "true") {
    return true
  } else {
    return false;
  }
}

Client.getSpringfileModified = function() {
  const modified = localStorage.getItem("springfile-modified");
  if (modified === null) {
    Client.setSpringfileModified((new Date(0)).toUTCString());
    return localStorage.getItem("springfile-modified");
  }
  return modified;
}

Client.setSpringfileModified = function(httpDate) {
  localStorage.setItem("springfile-modified", httpDate);
}

Client.pullSpringfile = async function() {
  if (Client.getShouldSync() !== true) {
    console.log("Syncing is off, so I won't pull the Springfile.")
    return;
  }

  console.log("Pulling Springfile");

  const public = Client.getPublicKey();
  const secret = Client.getSecretKey();
  // Very simple authorization here: prove it's you!
  const getAsBytes = Client.encoder.encode("GET");
  const signatureBytes = await nobleEd25519.sign(getAsBytes, secret);
  const signature = nobleEd25519.utils.bytesToHex(signatureBytes);

  const url = `${Client.CONFIG_SYNC}${public}`;

  try {
    let response = await fetch(url, {
      method: "GET",
      mode: "cors",
      headers: {
        "If-Modified-Since": Client.getSpringfileModified(),
        "Content-Type": "text/plain;charset=utf-8",
        "Spring-Signature": signature
      }
    });

    if (response.ok) {
      const body = await response.text();
      if ((body !== null) &&
          (body !== "") &&
          (body !== Client.springfileEditor.value)) {
        Client.springfileEditor.value = body;
        localStorage.setItem("springfile", body);
        console.log("loaded springfile editor with synced content, woo");
        const modifiedHTTP = response.headers.get("Last-Modified");
        Client.setSpringfileModified(modifiedHTTP);
        console.log("set springfile-modified to" + modifiedHTTP);
      } else {
        console.log("pulled a springfile that was either identical or empty, meh");
      }
    }

  } catch (e) {
    console.log("error pulling springfile:");
    console.log(e);
  }
}

Client.pushSpringfile = async function() {
  if (Client.getShouldSync() !== true) {
    console.log("Syncing is off, so I won't push the Springfile.")
    return;
  }

  console.log("Pushing Springfile");

  const springfile = localStorage.getItem("springfile");
  if (springfile === null) {
    console.log("got null springfile trying to start push, wut");
    return;
  }

  const public = Client.getPublicKey();
  const secret = Client.getSecretKey();
  const springfileBytes = Client.encoder.encode(springfile);
  const signatureBytes = await nobleEd25519.sign(springfileBytes, secret);
  const signature = nobleEd25519.utils.bytesToHex(signatureBytes);

  const url = `${Client.CONFIG_SYNC}${public}`;

  try {
    let response = await fetch(url, {
      method: "PUT",
      mode: "cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
        "Spring-Signature": signature
      },
      body: springfileBytes
    });

    if (response.status == 204) {
      Client.setSpringfileModified((new Date()).toUTCString());
      console.log("successfully synced springfile to remote server");
    }
  } catch (e) {
    console.log("error in syncSpringFile, ugh");
    console.log(e);
  }
}

// -- Here's the beating heart --

Client.parseSpringfile = async function() {

  // reset default configs, to be set by Springfile
  Client.setShouldSync(false);

  let newSources = {};
  let index = 0;

  let previousLine = null;

  // reset pet names
  Client.hypocorisms = {};

  // It's a bit muddled the way the user's public key stuff is included at the top here -- maybe think about breaking it out?
  // I guess I'll leave it here until it becomes a problem 👹

  // Does the user have a board?
  let publicKey = Client.getPublicKey();
  if (publicKey) {
    Client.hypocorisms[publicKey] = "Your board";
    newSources[publicKey] = {
      type: "board",
      url: Client.getHomeServer() + publicKey,
      index: -1, // always first
      lastChecked: -1,
      lastHeardFrom: -1,
      timeout: 0
    };
  }

  let springfile = Client.springfileEditor.value;

  springfile.split("\n").forEach((line) => {
    let trimmed = line.trim();

    if (trimmed[0] == "#") {
      // It's a comment, ignore it
      previousLine = null;
      return;
    }

    if (trimmed.length == 0) {
      previousLine = null;
      return;
    }

    // there's only one config flag currently
    // in a world of many config flags, obviously this would be more robust
    if (trimmed.substr(0, 8).toLowerCase() === "set sync") {
      const parts = trimmed.split(" ");
      if (parts[2] === null) { return; }
      const value = parts[2].trim().toLowerCase();
      if (value === "true") {
        console.log("setting sync TRUE");
        Client.setShouldSync(true);
      } else {
        console.log("leaving sync FALSE");
      }
      return;
    }

    try {
      let url = new URL(trimmed);
      if (url) {
        // NOTE I am just matching the pathname here, not the full URL
        const keyMatch = url.pathname.match(Client.KEY_REGEX);
        if (keyMatch) {
          // It is a Spring '83 URL

          // normalize
          let key = keyMatch[1].replace(/\//g, "").toLowerCase().trim();
          let keyURL = url.origin + "/" + key;

          // TODO actually validate key

          if (previousLine) {
            Client.hypocorisms[key] = previousLine;
          } else {
            // Just a little peek of the key
            Client.hypocorisms[key] = key.slice(0, 12) + "&hellip;"
          }
          if (Client.sources[key]) {
            // We want to retain previous info about server availability
            // but we do have to remap the index
            newSources[key] = Client.sources[key];
            newSources[key].index = index++;
          } else {
            // It's a key we haven't seen, so we'll initialize it
            newSources[key] = {
              type: "board",
              url: keyURL,
              index: index++, // is this too cryptic/tricky? I like it
              lastChecked: -1,
              lastHeardFrom: -1,
              timeout: Math.round(Client.BASE_TIMEOUT_SECONDS * Math.random())
            };
          }
        } else {
          // It's not a Spring '83 URL, so let's try RSS

          let feedKey = trimmed.replace(/\W/g, "_");
          if (previousLine) {
            Client.hypocorisms[feedKey] = previousLine;
          }
          if (Client.sources[feedKey]) {
            // Keep the data, but remap the index
            newSources[feedKey] = Client.sources[feedKey];
            newSources[feedKey].index = index++;
          } else {
            newSources[feedKey] = {
              type: "feed",
              index: index++, // is this too cryptic/tricky? I like it
              url: url.toString(),
              feedUrl: null,
              lastChecked: -1,
              lastHeardFrom: -1,
              timeout: Math.round(Client.BASE_TIMEOUT_SECONDS * Math.random())
            }
          }
        } // end else

        // We just processed a URL of some kind, so:
        previousLine = null;
      }
    } catch (e) {
      // Lines not parsable as URLs drop us down here:
      if (trimmed.length > 1) {
        // This is potentially the memo for the NEXT line
        previousLine = trimmed;
      } else {
        previousLine = null;
      }
    }
  });

  Client.sources = newSources;
}

// -- Board editing --

Client.clearDraftHTML = function() {
  const public = Client.getPublicKey();
  if (public) {
    localStorage.removeItem(`draft-${public}`);
    return true;
  }

  return false;
}

Client.setDraftHTML = function(draftHTML) {
  const public = Client.getPublicKey();
  if (public) {
    localStorage.setItem(`draft-${public}`, draftHTML);
    return true;
  }

  return false;
}

Client.getDraftHTML = function() {
  const public = Client.getPublicKey();
  if (public) {
    let draftHTML = localStorage.getItem(`draft-${public}`);
    if (draftHTML) {
      return draftHTML;
    } else {
      return null;
    }
  }

  return null;
}

Client.loadEditorHTML = function() {
  const public = Client.getPublicKey();

  if (public) {
    const draftHTML = Client.getDraftHTML();
    if (draftHTML) {
      Client.editor.session.setValue(draftHTML);
      return;
    } else {
      // This shouldn't happen too often
      const boardHTML = Client.getBoardHTML(public);
      if (boardHTML) {
        Client.editor.session.setValue(boardHTML);
        return;
      }
    }
  }

  // Oh well!
  Client.editor.session.setValue(`Hello, world!`);
}

Client.handleEditorChange = async function() {
  const contents = Client.editor.getValue();
  if (contents.length == 0) {
    Client.clearDraftHTML();
   } else {
    Client.setDraftHTML(contents);
  }

  Client.updateByteCounter();
}

Client.updateByteCounter = async function() {
  const bytes = Client.encoder.encode(await Client.renderFullBoardHTML()).length;

  let message = `with the timestamp added, that's ${bytes} bytes`;

  if (bytes > 2217) {
    message = `${bytes} bytes! too many bytes!`;
    Client.publishButton.classList.add("byte-overflow");
    Client.byteCounter.classList.add("byte-overflow");
    Client.okayToPublish = false;
  } else {
    Client.publishButton.classList.remove("byte-overflow");
    Client.byteCounter.classList.remove("byte-overflow");
    Client.okayToPublish = true;
  }

  document.querySelector("byte-counter").innerHTML = message;
}

// -- Board publishing --

Client.displayPublishError = async function(message) {
  Client.byteCounter.innerHTML = `error: ${message}`;
}

Client.resetPublishError = async function() {
  Client.updateByteCounter();
}

Client.publishBackupBoard = async function(fullBoard, signature) {
  // tons of duplication here
  // but I cannot currently be bothered to abstract it out
  const backup = Client.getBackupServer();
  if (backup === null || backup === "none") {
    console.log("skipping backup server");
    return;
  }
  console.log("publishing to backup server");

  const public = Client.getPublicKey();
  const path = `${backup}${public}`;

  let response;
  try {
    response = await fetch(path, {
      method: "PUT",
      mode: "cors",
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Spring-Signature": signature,
        "Spring-Version": "83"
      },
      body: Client.encoder.encode(fullBoard) // MARK -- MAYBE
    });
  } catch (e) {
    console.log("Error with publish to backup:");
    console.log(e);
  }
}

Client.publishBoard = async function() {
  const secret = Client.getSecretKey();
  const public = Client.getPublicKey();

  if (secret == null) {
    Client.displayPublishError("no keypair in storage");
    return;
  }

  const fullBoard = await Client.renderFullBoardHTML();

  const fullBoardForSigning = Client.encoder.encode(fullBoard);
  const signatureBytes = await nobleEd25519.sign(fullBoardForSigning, secret);
  const signature = nobleEd25519.utils.bytesToHex(signatureBytes);

  const verified = await nobleEd25519.verify(signature, fullBoardForSigning, public);

  if (verified) {
    console.log("Verified my own signature, nice");
  } else {
    console.log("Hmm I screwed up my own signature");
  }

  Client.publishBackupBoard(fullBoard, signature); // fire and forget

  // TODO: some retry logic...?

  const path = `${Client.getHomeServer()}${public}`;

  try {
    const response = await fetch(path, {
      method: "PUT",
      mode: "cors",
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Spring-Signature": signature,
        "Spring-Version": "83"
      },
      body: Client.encoder.encode(fullBoard) // MARK -- MAYBE
    });

    if (response.ok) {
      Client.publishButton.innerHTML = "Published!";
      Client.resetPublishError();
      Client.checkBoardSource(public, true);
      return;
    }

    if (response.status == 304) {
      Client.publishButton.innerHTML = "(already published)";
      return;
    }

    if (response.status >= 400) {
      console.log("some kind of errorrrrr");
      // TODO better response code handling...
    }

  } catch (e) {
    console.log(e);
    console.log("Error with fetch; server not found? TODO, document.");
  }

  // If we fell through to this, we failed
  Client.publishButton.innerHTML = "Publish";
  Client.displayPublishError("couldn't contact your home server");
}

// -- Board handling stuff --

Client.renderFullBoardHTML = async function() {
  let t = performance.now();
  const timestamp = new Date().toISOString().slice(0, 19) + "Z";
  const boardMarkdown = Client.editor.getValue();
  const boardHTML = marked.parse(boardMarkdown);
  const timeElement = `<time datetime="${timestamp}"></time>\n`;
  console.log(`rendered full board HTML in ${(performance.now() - t).toPrecision(2)} seconds`);
  return timeElement + boardHTML;
}

Client.setBoardHTML = function(key, board) {
  localStorage.setItem(key, board);
}

Client.getBoardHTML = function(key) {
  return localStorage.getItem(key);
}

// -- Equivalents for feeds --

Client.setFeedHTML = function(url, content) {
  localStorage.setItem(`feed-${url}`, content);
}

Client.getFeedHTML = function(url) {
  return localStorage.getItem(`feed-${url}`);
}

// -- View source --

Client.showViewSource = function(key) {
  const id = `board-${key}`;
  let viewSource = document.querySelector(`#${id} view-source`);
  viewSource.style.display = "block";
}

Client.hideViewSource = function(key) {
  const id = `board-${key}`;
  let viewSource = document.querySelector(`#${id} view-source`);
  viewSource.style.display = "none";
}

// -- Item retrieval and display --

Client.reloadItemGrid = async function(forceCheck = false) {
  const itemGrid = document.querySelector("item-grid");
  if (itemGrid) {
    itemGrid.innerHTML = "";
  }

  Object.keys(Client.sources).forEach(async (key) => {
    const source = Client.sources[key];
    if (source.type === "board") {
      Client.createBoardItem(key, forceCheck);
    }
    if (source.type === "feed") {
      Client.createFeedItem(key, forceCheck);
    }
  });
}

Client.checkSources = async function(forceCheck = false) {
  // The idea is that we run the check functions relatively often,
  // but they often return quickly, saying "nah, not yet"

  Object.keys(Client.sources).forEach(async (key) => {
    const source = Client.sources[key];
    if (source.type === "board") {
      await Client.checkBoardSource(key, forceCheck);
    }
    if (source.type === "feed") {
      await Client.checkFeedSource(key, forceCheck);
    }
  });
}

// -- Board sources --

Client.checkBoardSource = async function(key, forceCheck = false) {
  let source = Client.sources[key];

  if (!source) {
    console.log("tried to checkBoardSource for a key I don't know anything about:");
    console.log(key);
    return false;
  }

  if (!forceCheck && ((source.lastChecked + source.timeout) <= Date.now())) {
    console.log(`Not ready to check ${key} yet.`);
    return false;
  }

  const url = source.url;
  console.log(`Checking board at URL: ${url}`);

  // TODO might be able to just check existing board HTML,
  // rather than maintain this other data structure. Fine for now though
  let ifModifiedSince = Client.boardTimestamps[key] ? Client.boardTimestamps[key] : new Date(0);

  source.lastChecked = Date.now();

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      mode: "cors",
      headers: {
        "If-Modified-Since": new Date(ifModifiedSince).toUTCString(),
        "Spring-Version": "83"
      }
    });
  } catch (e) {
    console.log("Error with board fetch; server not found?");
    console.log("Extending timeout with jittered exponential backoff.");
    source.timeout = source.timeout + Math.round(source.timeout * Math.random());
    source.timeout = Math.min(source.timeout, Client.MAX_TIMEOUT_SECONDS);
    return;
  }

  source.lastHeardFrom = Date.now();

  // jitter the timeout
  source.timeout = Client.BASE_TIMEOUT_SECONDS +
                   Math.round(Client.BASE_TIMEOUT_SECONDS * Math.random());

  if (!response) {
    console.log("Null response fell through in checkBoardSource... this shouldn't happen");
    return;
  }

  if (response.status == 304) {
    console.log("No new board available for this key.");
    return false;
  }

  if (response.status == 404) {
    console.log("No board found for this key.");
    return false;
  }

  const signature = response.headers.get("Spring-Signature");
  if (!signature) {
    console.log("Server didn't sign the response.");
    return false;
  }

  const board = await response.text();

  // https://stackoverflow.com/questions/6965107/converting-between-strings-and-arraybuffers
  const boardForVerification = Client.encoder.encode(board);

  const verified = await nobleEd25519.verify(signature, boardForVerification, key);

  if (verified) {
    console.log("Signature verified, how nice.");
  } else {
    console.log("Signature is not correct; dropping");
    return false;
    // TODO mark server as untrustworthy
  }

  // See, here I just treat the HTML as the "canonical" source of timestamps
  // It's really a muddle
  // TODO: clean up!
  const existingBoard = Client.getBoardHTML(key);
  if (existingBoard) {
    const existingTimestamp = await Client.lastModifiedInHTML(existingBoard);
    const incomingTimestamp = await Client.lastModifiedInHTML(board);

    if (existingTimestamp >= incomingTimestamp) {
      console.log("New board is older or equivalent to the one I have. Ignoring.");
      return false;
    } else {
      Client.boardTimestamps[key] = incomingTimestamp;
    }
  }

  Client.setBoardHTML(key, board);
  Client.refreshBoardItem(key);

  return true;
}

Client.createBoardItem = function(key) {
  const id = `board-${key}`;
  const index = Client.sources[key].index;

  let template = document.querySelector("template#board-template");
  let boardDisplay = template.content.cloneNode(true);
  // I find it confusing that I still have to query into the board-item here:
  let boardItem = boardDisplay.querySelector("board-item");

  boardItem.id = id;
  boardItem.style.order = `${index}`;
  boardItem.dataset.index = index;

  let boardArea = boardItem.querySelector("board-area");
  let viewSource = boardArea.querySelector("view-source");
  let viewSourceTextArea = viewSource.querySelector("textarea");

  // CONJURE THE SHADOW DOM, RAHHH
  let boardContent = boardItem.querySelector("board-content");
  boardContent.attachShadow({mode: "open"});

  const boardHTML = Client.getBoardHTML(key);
  if (boardHTML) {
    // MARK -- I am adding this little scrap of CSS here
    boardContent.shadowRoot.innerHTML = DEFAULT_BOARD_CSS + boardHTML;
    // TODO: what I'd really like to do is strip out the <time> tag here...
    viewSourceTextArea.innerHTML = boardHTML;
  }

  // In the functions below, I never actually expect the locally-bound variables like `viewSource` and `boardContent` to work inside these callbacks... but they do... and it's weird

  // Click handler to SHOW View Source
  viewSource.addEventListener("click", (e) => {
    // it's brittle!
    viewSource.style.zIndex = "1000";
    viewSourceTextArea.style.cursor = "text";
    viewSourceTextArea.classList.add("showing");
    boardContent.style.cursor = "pointer";
  });

  // Click handler to HIDE View Source
  boardContent.addEventListener("click", (e) => {
    // yep, pretty brittle!
    if (viewSource.style.zIndex == "1000") {
      viewSource.style.zIndex = "10";
      viewSourceTextArea.style.cursor = "pointer";
      viewSourceTextArea.classList.remove("showing");
      boardContent.style.cursor = "default";
    }
  });

  if (Client.hypocorisms[key]) {
    boardItem.querySelector("board-label").innerHTML = Client.hypocorisms[key];
  }

  Client.itemGrid.append(boardItem);
  Client.observer.observe(boardItem);

  Client.checkBoardSource(key, true); // force

  return boardItem;
}

Client.refreshBoardItem = function(key) {
  let boardHTML = Client.getBoardHTML(key);

  if (boardHTML === null) {
    boardHTML = `
    <style>
      div {
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
        height: 100%;
      }

      p {
        text-align: center;
        width: 50%;
      }
    </style>
    <div><p>No board found for key ${key.slice(0, 12)}&hellip;</p></div>
    `.trim();
  }

  let boardItem = document.querySelector(`#board-${key}`);

  boardItem.classList.add("refreshed");

  if (boardItem == null) {
    boardItem = Client.createBoardItem(key);
  }

  if (Client.hypocorisms[key]) {
    boardItem.querySelector("board-label").innerHTML = Client.hypocorisms[key];
  }

  let boardContent = boardItem.querySelector("board-content");
  let viewSourceContent = boardItem.querySelector("view-source textarea");

  // MARK -- I am adding the extra CSS here
  boardContent.shadowRoot.innerHTML = DEFAULT_BOARD_CSS + boardHTML;
  viewSourceContent.innerHTML = boardHTML;
}

// -- Feed sources --

Client.checkFeedSource = async function(feedKey, forceCheck = false) {
  let feedSource = Client.sources[feedKey];

  if (!forceCheck &&
     ((feedSource.lastChecked + feedSource.timeout) <= Date.now())) {
    console.log(`Not ready to check ${feedKey} yet.`);
    return false;
  }

  console.log(`Checking feed source ${feedKey}`);

  feedSource.lastChecked = Date.now();
  let fetchUrl = feedSource.url;

  // Have we found and memo-ized the correct feed URL?
  if (feedSource.feedUrl) {
    fetchUrl = feedSource.feedUrl;
  }

  try {
    // Send this through a proxy, because CORS
    let response = await fetch(Client.FEED_PROXY, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain" },
      body: fetchUrl
    });

    feedSource.lastHeardFrom = Date.now();
      // jitter the timeout
    const bodyText = await response.text();
    const contentType = response.headers.get("content-type");
    let parsed = Client.parseFeedSourceResponse(feedKey, fetchUrl, contentType, bodyText);
    if (parsed) {
      feedSource.timeout = Client.BASE_TIMEOUT_SECONDS +
                     Math.round(
                      Client.BASE_TIMEOUT_SECONDS * Math.random()
                     );
    } else {
      // exponential backoff for stuff that just doesn't work at all
      feedSource.timeout = feedSource.timeout +
                           Math.round(
                             feedSource.timeout * Math.random()
                           );
      feedSource.timeout = Math.min(
                            feedSource.timeout,
                            Client.MAX_TIMEOUT_SECONDS
                          );
    }
  } catch (e) {
    console.log("error in checkFeedSource:");
    console.log(e);
  }
}

// returns false if it doesn't see a path forward at all
Client.parseFeedSourceResponse = async function(feedKey, fetchedUrl,
                                                contentType, bodyText) {
  // We will try to be improvisational rather than brittle here.

  let feedSource = Client.sources[feedKey];

  // First, if it's an actual RSS feed:
  const isRSSFeed = contentType.includes("rss") ||
                    contentType.includes("xml");

  if (isRSSFeed) {
    // Yes! Memo-ize this as the official feed URL!
    // So we don't have to go searching in the HTML (below) more than once
    feedSource.feedUrl = fetchedUrl;

    let xmlDOM = await Client.parser.parseFromString(bodyText, "text/xml");
    if (xmlDOM) {
      let item = xmlDOM.querySelector(`item`) || xmlDOM.querySelector(`entry`);
      if (item) {
        let link = item.querySelector(`link[type="text/html"]`) || item.querySelector("link");
        let feedTitleElement = xmlDOM.querySelector("channel title") || xmlDOM.querySelector("feed title");
        let itemTitleElement = item.querySelector("title");

        let href = link?.getAttribute("href") || link?.innerHTML || "#";
        let feedTitleText = feedTitleElement?.text || feedTitleElement?.childNodes[0]?.nodeValue || "unknown title";
        let itemTitleText = itemTitleElement?.text || itemTitleElement?.childNodes[0]?.nodeValue || href;

        let displayedTitle = Client.hypocorisms[feedKey] ? Client.hypocorisms[feedKey] : feedTitleText;
        const content = `<h1>${displayedTitle}</h1><h2><a href="${href}" target="_new">${itemTitleText}</a></h2>`;

        Client.setFeedHTML(feedKey, content);
        Client.refreshFeedItem(feedKey);
        return true;
      }
    }
  }

  // Not an RSS feed, huh...
  // Well, maybe it's an HTML page. We can work with that:
  let htmlDOM = await Client.parser.parseFromString(bodyText, "text/html");
  if (htmlDOM) {
    let link = htmlDOM.querySelector(`head link[rel="alternate"]`);
    if (link) {
      let url = link.getAttribute("href")
      try {
        let trial = new URL(url);
        if (trial) {
          // We "annotate" the feedSource object with this new information
          feedSource.feedUrl = trial.href;
          Client.checkFeedSource(feedKey, true); // force
          return true;
        }
      } catch (e) {
        // This catches when the creation of the URL fails
        // so we try another strategy
        try {
          let basename = new URL(fetchedUrl).href + "/";
          if (new URL(basename + url)) {
            feedSource.feedUrl = basename + url;
            Client.checkFeedSource(feedKey, true); // force
            return true;
          }
        } catch (e) {
          // This catches when the other strategy didn't work either!!
          console.log("Can't seem to get anything out of this URL:");
          console.log(url);
          return false;
        }
      }
    }
  }

  // shouldn't get down here!
  return false;
}

Client.createFeedItem = function(feedKey) {
  const id = `feed-${feedKey}`;
  const feedSource = Client.sources[feedKey];

  let template = document.querySelector("template#feed-template");
  let feedDisplay = template.content.cloneNode(true);
  // I find it confusing that I still have to query into the feed-item here:
  let feedItem = feedDisplay.querySelector("feed-item");

  feedItem.id = id;
  feedItem.dataset.index = feedSource.index;
  feedItem.style.order = `${feedSource.index}`;

  let feedArea = feedItem.querySelector("feed-area");

  const feedContent = Client.getFeedHTML(feedKey);
  if (feedContent) {
    feedArea.innerHTML = feedContent;
  } else {
    feedArea.innerHTML = `<p>Nothing yet for ${feedSource.url}</p>`;
  }

  Client.itemGrid.append(feedItem);
  Client.checkFeedSource(feedKey, true); // force
  return feedItem;
}

Client.refreshFeedItem = function(feedKey) {
  let feedHTML = Client.getFeedHTML(feedKey);
  // TODO I think this never executes, which is OK:
  if (feedHTML === null) {
    feedHTML = `<p>Couldn't find anything stored at ${Client.sources[feedKey].url} 😔</p>`;
  }
  const id = `feed-${feedKey}`;
  let feedItem = document.querySelector(`#${id}`);

  if (feedItem == null) {
    feedItem = Client.createFeedItem(feedKey);
  }

  let feedArea = feedItem.querySelector("feed-area");
  feedArea.innerHTML = feedHTML;
}

DEFAULT_BOARD_CSS = `
<style>
  :host {
    background-color: var(--c-paper-bright);
    box-sizing: border-box;
    padding: 2rem;
  }
  time { display: none; }
  p, h1, h2, h3, h4, h5 { margin: 0 0 2rem 0; }
</style>
`.trim();

STARTER_SPRINGFILE = `
This is your Springfile. You can enter Spring '83 URLs, one on each line. This demo client will try its best to retrieve feeds, too, so feel free to drop in RSS and website URLs.

Anything that's not a Spring '83 key or a URL will be ignored, so you can jot notes here, as well -- just like this. Here's a trick: the line preceding a key or URL will be used as its label, so consider typing an annotation that's meaningful to you.

Boards and feed items will be displayed in the order you list them here.

** Your Springfile will probably get blown away at some point, so be sure to back it up! Just email it to yourself, easy. **

There's currently one (1) configuration setting, which is the line that comes next. If you'd like to disable Springfile synchronization between browsers, rewrite the value to "false":

set sync true

Robin's board
https://bogbody.biz/1e4bed50500036e8e2baef40cb14019c2d49da6dfee37ff146e45e5c783e0123

Boards to follow
https://bogbody.biz/0036a2f1d481668649bc5c2a50f40cc9a65d3244eff0c0002af812e6183e0523

Alan Jacobs
https://blog.ayjay.org/feed/

Elisabeth Nicula's HTML art
https://abjectsubli.me/feed.xml

Sven, board artisan
https://bogbody.biz/a5e8086dd47d0380ed16c641070636a3f06fc89b6f6dde45e756f70fc83e0723

Spring '83 dev board
https://bogbody.biz/ca93846ae61903a862d44727c16fed4b80c0522cab5e5b8b54763068b83e0623

honor, artist
https://bogbody.biz/e310afd5a0529279947e4bb79ae686543102a8e864867dd4b8e90101e83e0123

Chase, designer
https://bogbody.biz/45deb6f6d50b7b2e3a0aba5aa199823a3c0e64e5f604196e429bc41d683e0623

Chase's blog
https://chasem.co/feed.xml

Peter, keymaster
https://bogbody.biz/47e0f417f42634b42917124c8c9709714ac28c632830c2f96f8e52beb83e0623

Pulp Covers
https://pulpcovers.com/feed/

https://eukaryotewritesblog.com/feed/

Mandy Brown (mostly books)
https://aworkinglibrary.com/feed/index.xml

Ryan
https://bogbody.biz/f539c49d389b1e141c97450cdabc83d41615303106c07f63c8975b5dc83e0623

TOOZE!
https://adamtooze.substack.com/

Matt Webb, the superbrain
https://interconnected.org/home/feed

A Robin
https://www.robinsloan.com/feed.xml

Another Robin
https://www.robinrendle.com/

makeworld
https://bogbody.biz/3cba5aede1312bda77c2a329c61aadb893dae1c160bd4c5b05d3bad3783e1023

Maya
https://bogbody.biz/a4813793a806d066c18f8a2d07a403393fecda667e5ccaa6fd76cfd5683e1023

Maya's blog
https://maya.land/feed.xml

Journal of the History of Ideas
https://jhiblog.org/feed/

https://dancohen.org/feed/

Tom Armitage
https://infovore.org/

Roy
https://bogbody.biz/db8a22f49c7f98690106cc2aaac15201608db185b4ada99b5bf4f222883e1223

Phenomenal World newsletter
https://us16.campaign-archive.com/feed?u=30638b4a1754ffe5cdc9f22c1&id=31efc3f9d3

Dirt newsletter
https://dirt.substack.com/feed

Flywheel newsletter
https://www.newsletter.rideflywheel.com/feed

Hiroko's blog
http://rhiroko.blog.fc2.com/

100 Rabbits changelog
https://100r.co/links/rss.xml

Brett's movie reviews
https://letterboxd.com/bretterbox/rss/

Frances Coppola (macro, etc.)
https://www.coppolacomment.com/

https://www.ruby-lang.org/en/feeds/news.rss

Included to verify that broken feeds are handled appropriately:
https://feeds.transistor.fm/cassettes-with-william-july

Ever-changing test board
https://bogbody.biz/ab589f4dde9fce4180fcf42c7b05185b0a02a5d682e353fa39177995083e0583
`.trim();