let activeCategory = "ყველა";
let currentUser = null;
let openComments = new Set();

const defaultAvatar = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect width=%2260%22 height=%2260%22 rx=%2230%22 fill=%22%23ff9fd0%22/%3E%3Ctext x=%2230%22 y=%2238%22 text-anchor=%22middle%22 font-size=%2228%22%3E😄%3C/text%3E%3C/svg%3E";

const dailyJokes = [
  "რატომ არ ენდობა პროგრამისტი კიბეებს? იმიტომ რომ მათ ყოველთვის აქვთ steps.",
  "ჩემი გეგმა იმდენად იდეალური იყო, რეალობამ სიცილი დაიწყო.",
  "დილით ადრე ავდექი და ჩემმა ორგანიზმმა მკითხა: რამე მოხდა?",
  "უნივერსიტეტში მივედი ცოდნისთვის, მაგრამ PDF-ები დამხვდა."
];

function getToken() {
  return localStorage.getItem("token");
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function escapeHTML(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(dateText) {
  const date = new Date(dateText);
  return date.toLocaleDateString("ka-GE");
}

function getCategoryEmoji(category) {
  if (category === "სტუდენტური") return "🎓";
  if (category === "IT") return "💻";
  if (category === "ყოველდღიური") return "🚌";
  if (category === "შავი იუმორი") return "🖤";
  if (category === "აბსურდული") return "🐸";
  return "😂";
}


function showSelectedFileName(inputId, labelId) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);

  if (!input || !label) return;

  if (input.files && input.files[0]) {
    label.textContent = "არჩეულია: " + input.files[0].name;
  } else {
    label.textContent = "";
  }
}

function showPage(page) {
  document.getElementById("homePage").classList.add("hidden");
  document.getElementById("profilePage").classList.add("hidden");
  document.getElementById("adminPage").classList.add("hidden");

  if (page === "home") {
    document.getElementById("homePage").classList.remove("hidden");
    loadJokes();
  }

  if (page === "profile") {
    document.getElementById("profilePage").classList.remove("hidden");
    if (currentUser) loadProfile(currentUser.username);
    else document.getElementById("profileContent").innerHTML = "<p>პროფილის სანახავად ჯერ შედი ანგარიშში.</p>";
  }

  if (page === "admin") {
    document.getElementById("adminPage").classList.remove("hidden");
    loadAdminPanel();
  }
}

async function register() {
  const username = document.getElementById("authUsername").value.trim();
  const password = document.getElementById("authPassword").value;
  const error = document.getElementById("authError");
  error.textContent = "";

  const response = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json();

  if (!response.ok) {
    error.textContent = data.error || "რეგისტრაცია ვერ მოხერხდა.";
    return;
  }

  localStorage.setItem("token", data.token);
  currentUser = data;
  document.getElementById("authPassword").value = "";
  updateAuthUI();
  loadJokes();
}

async function login() {
  const username = document.getElementById("authUsername").value.trim();
  const password = document.getElementById("authPassword").value;
  const error = document.getElementById("authError");
  error.textContent = "";

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await response.json();

  if (!response.ok) {
    error.textContent = data.error || "შესვლა ვერ მოხერხდა.";
    return;
  }

  localStorage.setItem("token", data.token);
  currentUser = data;
  document.getElementById("authPassword").value = "";
  updateAuthUI();
  loadJokes();
}

async function logout() {
  await fetch("/api/logout", {
    method: "POST",
    headers: authHeaders()
  });

  localStorage.removeItem("token");
  currentUser = null;
  updateAuthUI();
  showPage("home");
}

async function checkMe() {
  const response = await fetch("/api/me", { headers: authHeaders() });
  currentUser = await response.json();

  if (!currentUser) localStorage.removeItem("token");

  updateAuthUI();
}

function updateAuthUI() {
  const guestBox = document.getElementById("guestBox");
  const userBox = document.getElementById("userBox");
  const currentUserElement = document.getElementById("currentUser");
  const roleBadge = document.getElementById("roleBadge");
  const currentAvatar = document.getElementById("currentAvatar");
  const adminNav = document.getElementById("adminNav");

  if (currentUser) {
    guestBox.classList.add("hidden");
    userBox.classList.remove("hidden");
    currentUserElement.textContent = "@" + currentUser.username;
    roleBadge.textContent = currentUser.role === "admin" ? "ADMIN" : "USER";
    currentAvatar.src = currentUser.avatar || defaultAvatar;

    if (currentUser.role === "admin") adminNav.classList.remove("hidden");
    else adminNav.classList.add("hidden");
  } else {
    guestBox.classList.remove("hidden");
    userBox.classList.add("hidden");
    adminNav.classList.add("hidden");
  }
}

async function uploadAvatar() {
  const file = document.getElementById("avatarInput").files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("avatar", file);

  const response = await fetch("/api/profile/avatar", {
    method: "POST",
    headers: authHeaders(),
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.error || "ფოტოს ატვირთვა ვერ მოხერხდა.");
    return;
  }

  currentUser.avatar = data.avatar;
  updateAuthUI();
}

async function loadJokes() {
  const search = document.getElementById("searchInput").value;
  const sort = document.getElementById("sortInput").value;

  const url = `/api/jokes?search=${encodeURIComponent(search)}&category=${encodeURIComponent(activeCategory)}&sort=${encodeURIComponent(sort)}`;

  const response = await fetch(url, { headers: authHeaders() });
  const jokes = await response.json();

  renderJokes(jokes);
  loadStats();
}

function renderJokes(jokes) {
  const list = document.getElementById("jokesList");

  if (jokes.length === 0) {
    list.innerHTML = '<div class="empty">ხუმრობა ვერ მოიძებნა 😢</div>';
    return;
  }

  list.innerHTML = jokes.map(joke => `
    <div class="joke-card" id="joke-${joke.id}">
      <div class="user-row">
        <div class="user">
          <img class="small-avatar" src="${joke.avatar || defaultAvatar}" />
          <a onclick="openProfile('${escapeHTML(joke.username)}')">@${escapeHTML(joke.username)}</a>
          ${joke.isAdminView && joke.canEdit ? '<span class="admin-mark">admin control</span>' : ''}
        </div>
        <div class="date">${formatDate(joke.created_at)}</div>
      </div>

      <div class="joke-text">${escapeHTML(joke.text)}</div>

      ${joke.image ? `<img class="joke-image" src="${escapeHTML(joke.image)}" />` : ""}

      <div class="tags">
        <span>${getCategoryEmoji(joke.category)} ${escapeHTML(joke.category)}</span>
        <span>💬 ${joke.commentsCount}</span>
        ${joke.isAdminView ? `<span>🚩 ${joke.reportsCount}</span>` : ""}
      </div>

      <div class="reactions">
        <button onclick="react(${joke.id}, 'laughs')">😂 ${joke.laughs}</button>
        <button onclick="react(${joke.id}, 'dead')">💀 ${joke.dead}</button>
        <button onclick="react(${joke.id}, 'hmm')">🤨 ${joke.hmm}</button>
        <button onclick="toggleComments(${joke.id})">კომენტარები</button>
        <button class="report-btn" onclick="showReportBox(${joke.id})">Report</button>
        ${joke.canEdit ? `
          <button class="owner-btn" onclick="showEditBox(${joke.id}, '${encodeURIComponent(joke.text)}', '${encodeURIComponent(joke.category)}')">რედაქტირება</button>
          <button class="delete-btn" onclick="deleteJoke(${joke.id})">წაშლა</button>
        ` : ""}
      </div>

      <div class="report-box hidden" id="report-${joke.id}">
        <input type="text" id="reportReason-${joke.id}" placeholder="რატომ არ მოგწონს ეს პოსტი?" />
        <button class="btn small-btn" onclick="sendReport(${joke.id})">გაგზავნა</button>
        <button class="light-btn" onclick="hideReportBox(${joke.id})">გაუქმება</button>
        <p class="error" id="reportError-${joke.id}"></p>
      </div>

      <div class="edit-box hidden" id="edit-${joke.id}">
        <textarea id="editText-${joke.id}"></textarea>
        <select id="editCategory-${joke.id}">
          <option value="სტუდენტური">🎓 სტუდენტური</option>
          <option value="IT">💻 IT</option>
          <option value="ყოველდღიური">🚌 ყოველდღიური</option>
          <option value="შავი იუმორი">🖤 შავი იუმორი</option>
          <option value="აბსურდული">🐸 აბსურდული</option>
        </select>
        <label class="file-label">
          შეცვალე ფოტო
          <input type="file" id="editImage-${joke.id}" accept="image/png,image/jpeg,image/webp,image/gif" onchange="showSelectedFileName(`editImage-${joke.id}`, `editImageName-${joke.id}`)" />\n          <span id="editImageName-${joke.id}" class="selected-file"></span>
        </label>
        <label class="rule"><input type="checkbox" id="removeImage-${joke.id}" /> ფოტოს წაშლა</label>
        <button class="btn small-btn" onclick="saveEdit(${joke.id})">შენახვა</button>
        <button class="light-btn" onclick="hideEditBox(${joke.id})">გაუქმება</button>
        <p class="error" id="editError-${joke.id}"></p>
      </div>

      <div class="comments-section hidden" id="comments-${joke.id}">
        <div id="commentsList-${joke.id}"></div>
        <textarea id="commentInput-${joke.id}" placeholder="დაწერე კომენტარი..."></textarea>
        <button class="btn small-btn" onclick="addComment(${joke.id})">კომენტარის დამატება</button>
        <p class="error" id="commentError-${joke.id}"></p>
      </div>
    </div>
  `).join("");
}

function showEditBox(id, encodedText, encodedCategory) {
  const text = decodeURIComponent(encodedText);
  const category = decodeURIComponent(encodedCategory);
  document.getElementById(`edit-${id}`).classList.remove("hidden");
  document.getElementById(`editText-${id}`).value = text;
  document.getElementById(`editCategory-${id}`).value = category;
}

function hideEditBox(id) {
  document.getElementById(`edit-${id}`).classList.add("hidden");
}

async function saveEdit(id) {
  const text = document.getElementById(`editText-${id}`).value.trim();
  const category = document.getElementById(`editCategory-${id}`).value;
  const file = document.getElementById(`editImage-${id}`).files[0];
  const removeImage = document.getElementById(`removeImage-${id}`).checked;
  const error = document.getElementById(`editError-${id}`);

  error.textContent = "";

  const formData = new FormData();
  formData.append("text", text);
  formData.append("category", category);
  formData.append("removeImage", removeImage ? "true" : "false");
  if (file) formData.append("image", file);

  const response = await fetch(`/api/jokes/${id}`, {
    method: "PUT",
    headers: authHeaders(),
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    error.textContent = data.error || "რედაქტირება ვერ მოხერხდა.";
    return;
  }

  loadJokes();
}

async function addJoke() {
  const text = document.getElementById("jokeInput").value.trim();
  const category = document.getElementById("categoryInput").value;
  const file = document.getElementById("jokeImageInput").files[0];
  const error = document.getElementById("errorText");

  error.textContent = "";

  const formData = new FormData();
  formData.append("text", text);
  formData.append("category", category);
  if (file) formData.append("image", file);

  const response = await fetch("/api/jokes", {
    method: "POST",
    headers: authHeaders(),
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    error.textContent = data.error || "შეცდომა მოხდა.";
    return;
  }

  document.getElementById("jokeInput").value = "";
  document.getElementById("jokeImageInput").value = "";
  const selectedName = document.getElementById("jokeImageName");
  if (selectedName) selectedName.textContent = "";
  loadJokes();
}

async function react(id, type) {
  const response = await fetch(`/api/jokes/${id}/react`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ type })
  });

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    alert(data.error || "Reaction-ის დასადებად ჯერ შედი ანგარიშში.");
    return;
  }

  loadJokes();
}

async function deleteJoke(id) {
  if (!confirm("ნამდვილად გინდა ამ ხუმრობის წაშლა?")) return;

  const response = await fetch(`/api/jokes/${id}`, {
    method: "DELETE",
    headers: authHeaders()
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.error || "წაშლა ვერ მოხერხდა.");
    return;
  }

  loadJokes();
  if (!document.getElementById("adminPage").classList.contains("hidden")) loadAdminPanel();
}

async function toggleComments(id) {
  const section = document.getElementById(`comments-${id}`);
  section.classList.toggle("hidden");

  if (!section.classList.contains("hidden")) {
    openComments.add(Number(id));
    loadComments(id);
  } else {
    openComments.delete(Number(id));
  }
}

async function loadComments(id) {
  const response = await fetch(`/api/jokes/${id}/comments`);
  const comments = await response.json();
  const list = document.getElementById(`commentsList-${id}`);

  if (comments.length === 0) {
    list.innerHTML = `<p class="rule">კომენტარები ჯერ არ არის.</p>`;
    return;
  }

  list.innerHTML = comments.map(comment => `
    <div class="comment">
      <div class="comment-head">
        <span><img class="small-avatar" src="${comment.avatar || defaultAvatar}" /> @${escapeHTML(comment.username)}</span>
        ${currentUser && (currentUser.role === "admin" || currentUser.id === comment.user_id) ? `<button class="delete-btn" onclick="deleteComment(${comment.id}, ${id})">წაშლა</button>` : ""}
      </div>
      <p>${escapeHTML(comment.text)}</p>
    </div>
  `).join("");
}


async function refreshJokeStatsOnly(id) {
  const search = document.getElementById("searchInput").value;
  const sort = document.getElementById("sortInput").value;
  const url = `/api/jokes?search=${encodeURIComponent(search)}&category=${encodeURIComponent(activeCategory)}&sort=${encodeURIComponent(sort)}`;
  const response = await fetch(url, { headers: authHeaders() });
  const jokes = await response.json();
  const joke = jokes.find(item => item.id === id);

  if (!joke) return;

  const card = document.getElementById(`joke-${id}`);
  if (!card) return;

  const tags = card.querySelector(".tags");
  if (tags) {
    tags.innerHTML = `
      <span>${getCategoryEmoji(joke.category)} ${escapeHTML(joke.category)}</span>
      <span>💬 ${joke.commentsCount}</span>
      ${joke.isAdminView ? `<span>🚩 ${joke.reportsCount}</span>` : ""}
    `;
  }
}

async function addComment(id) {
  const text = document.getElementById(`commentInput-${id}`).value.trim();
  const error = document.getElementById(`commentError-${id}`);
  error.textContent = "";

  const response = await fetch(`/api/jokes/${id}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ text })
  });

  const data = await response.json();

  if (!response.ok) {
    error.textContent = data.error || "კომენტარი ვერ დაემატა.";
    return;
  }

  document.getElementById(`commentInput-${id}`).value = "";
  loadComments(id);
  refreshJokeStatsOnly(id);
}

async function deleteComment(commentId, jokeId) {
  const response = await fetch(`/api/comments/${commentId}`, {
    method: "DELETE",
    headers: authHeaders()
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.error || "წაშლა ვერ მოხერხდა.");
    return;
  }

  loadComments(jokeId);
}

function showReportBox(id) {
  document.getElementById(`report-${id}`).classList.remove("hidden");
}

function hideReportBox(id) {
  document.getElementById(`report-${id}`).classList.add("hidden");
}

async function sendReport(id) {
  const reason = document.getElementById(`reportReason-${id}`).value.trim();
  const error = document.getElementById(`reportError-${id}`);
  error.textContent = "";

  const response = await fetch(`/api/jokes/${id}/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ reason })
  });

  const data = await response.json();

  if (!response.ok) {
    error.textContent = data.error || "Report ვერ გაიგზავნა.";
    return;
  }

  alert("Report გაიგზავნა.");
  hideReportBox(id);
}

function openProfile(username) {
  showPage("profile");
  loadProfile(username);
}

async function loadProfile(username) {
  const response = await fetch(`/api/users/${encodeURIComponent(username)}`);
  const data = await response.json();
  const box = document.getElementById("profileContent");

  if (!response.ok) {
    box.innerHTML = `<p>${data.error || "პროფილი ვერ მოიძებნა."}</p>`;
    return;
  }

  box.innerHTML = `
    <div class="profile-head">
      <img src="${data.user.avatar || defaultAvatar}" />
      <div>
        <h2>@${escapeHTML(data.user.username)}</h2>
        <p class="role-badge">${data.user.role}</p>
        <p class="rule">ხუმრობები: ${data.jokes.length} | კომენტარები: ${data.commentsCount}</p>
      </div>
    </div>

    <h3>ამ მომხმარებლის ხუმრობები</h3>
    ${data.jokes.length === 0 ? `<p class="rule">ჯერ ხუმრობა არ დაუდია.</p>` : data.jokes.map(joke => `
      <div class="joke-card">
        <div class="joke-text">${escapeHTML(joke.text)}</div>
        ${joke.image ? `<img class="joke-image" src="${escapeHTML(joke.image)}" />` : ""}
        <div class="tags">
          <span>${getCategoryEmoji(joke.category)} ${escapeHTML(joke.category)}</span>
          <span>😂 ${joke.laughs}</span>
          <span>💀 ${joke.dead}</span>
          <span>🤨 ${joke.hmm}</span>
        </div>
      </div>
    `).join("")}
  `;
}

async function loadAdminPanel() {
  if (!currentUser || currentUser.role !== "admin") {
    document.getElementById("reportsList").innerHTML = "<p>Admin არ ხარ.</p>";
    return;
  }

  const reportsResponse = await fetch("/api/admin/reports", { headers: authHeaders() });
  const reports = await reportsResponse.json();

  const usersResponse = await fetch("/api/admin/users", { headers: authHeaders() });
  const users = await usersResponse.json();

  document.getElementById("reportsList").innerHTML = reports.length === 0
    ? `<p class="rule">Reports არ არის.</p>`
    : reports.map(report => `
      <div class="report-card">
        <b>🚩 Report by @${escapeHTML(report.username)}</b>
        <p><b>Reason:</b> ${escapeHTML(report.reason)}</p>
        <p><b>Joke author:</b> @${escapeHTML(report.joke_author || "deleted")}</p>
        <p>${escapeHTML(report.joke_text || "Joke deleted")}</p>
        ${report.joke_image ? `<img src="${escapeHTML(report.joke_image)}" />` : ""}
        <button class="light-btn" onclick="clearReport(${report.id})">Report-ის წაშლა</button>
        ${report.joke_id ? `<button class="delete-btn" onclick="deleteJoke(${report.joke_id})">ხუმრობის წაშლა</button>` : ""}
      </div>
    `).join("");

  document.getElementById("usersList").innerHTML = users.map(user => `
    <div class="user-card">
      <div class="avatar-row">
        <img class="avatar" src="${user.avatar || defaultAvatar}" />
        <div>
          <b>@${escapeHTML(user.username)}</b>
          <p class="role-badge">${user.role}</p>
          <p class="rule">Jokes: ${user.jokesCount} | Comments: ${user.commentsCount}</p>
        </div>
      </div>
    </div>
  `).join("");
}

async function clearReport(id) {
  await fetch(`/api/admin/reports/${id}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  loadAdminPanel();
}

function filterCategory(category, element) {
  activeCategory = category;
  document.querySelectorAll(".category").forEach(item => item.classList.remove("active"));
  element.classList.add("active");
  loadJokes();
}

async function loadStats() {
  const response = await fetch("/api/stats");
  const stats = await response.json();

  document.getElementById("totalJokes").textContent = stats.totalJokes;
  document.getElementById("totalLaughs").textContent = stats.totalLaughs;
  document.getElementById("topCategory").textContent = stats.topCategory;
}

function changeDailyJoke() {
  const random = Math.floor(Math.random() * dailyJokes.length);
  document.getElementById("dailyJokeText").textContent = dailyJokes[random];
}

function scrollToPost() {
  document.getElementById("post").scrollIntoView({ behavior: "smooth" });
}

changeDailyJoke();
checkMe().then(loadJokes);


async function refreshVisibleData() {
  if (!document.getElementById("homePage").classList.contains("hidden")) {
    await loadJokes();
    openComments.forEach(jokeId => loadComments(jokeId));
  }

  if (currentUser && currentUser.role === "admin" && !document.getElementById("adminPage").classList.contains("hidden")) {
    loadAdminPanel();
  }
}

setInterval(refreshVisibleData, 5000);
