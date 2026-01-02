// Global app state
let currentUser = null;

// Ensure lucide icons are loaded and rendered
function ensureLucide() {
  return new Promise((resolve) => {
    if (typeof lucide !== "undefined") {
      try {
        lucide.createIcons();
      } catch (e) {}
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/lucide@latest";
    s.onload = () => {
      try {
        lucide.createIcons();
      } catch (e) {}
      resolve();
    };
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

// Global sidebar toggle function
function toggleSidebar() {
  const sidebar =
    document.getElementById("sidebar") || document.querySelector("aside");
  let sidebarOverlay = document.getElementById("sidebar-overlay");
  if (!sidebarOverlay) {
    sidebarOverlay = document.createElement("div");
    sidebarOverlay.id = "sidebar-overlay";
    sidebarOverlay.className =
      "fixed inset-0 bg-slate-950/60 z-30 hidden md:hidden transition-opacity duration-300";
    sidebarOverlay.onclick = closeSidebarOnMobile;
    document.body.appendChild(sidebarOverlay);
  }
  const hamburgerIcon = document.querySelector(".hamburger-icon");
  const closeIcon = document.querySelector(".close-icon");

  if (!sidebar || !sidebarOverlay) return;

  const isOpen =
    sidebar.classList.contains("translate-x-0") &&
    !sidebar.classList.contains("-translate-x-full");

  if (isOpen) {
    // Close sidebar
    sidebar.classList.remove("translate-x-0");
    sidebar.classList.add("-translate-x-full");
    sidebarOverlay.classList.add("hidden");
    // Toggle icons
    if (hamburgerIcon) hamburgerIcon.classList.remove("hidden");
    if (closeIcon) closeIcon.classList.add("hidden");
  } else {
    // Open sidebar
    sidebar.classList.remove("-translate-x-full");
    sidebar.classList.add("translate-x-0");
    sidebarOverlay.classList.remove("hidden");
    // Toggle icons
    if (hamburgerIcon) hamburgerIcon.classList.add("hidden");
    if (closeIcon) closeIcon.classList.remove("hidden");
  }
}

// Function to close sidebar on mobile when clicking navigation links
function closeSidebarOnMobile() {
  // Only close on mobile devices
  if (window.innerWidth < 768) {
    toggleSidebar();
  }
}

// Load HTML components
async function loadHTML(selector, url) {
  try {
    console.log("loadHTML: fetching", url, "for", selector);
    const response = await fetch(url);
    console.log("loadHTML: response", response.status, response.url);
    const html = await response.text();

    const container = document.querySelector(selector);
    if (!container) {
      console.warn("loadHTML: selector not found", selector);
      return;
    }

    // Insert HTML
    container.innerHTML = html;
    container.dataset.componentUrl = url;
    container.dataset.componentLoaded = "false";

    // Execute any scripts within fetched HTML (both external and inline)
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const scripts = temp.querySelectorAll("script");
    console.log("loadHTML:", selector, "found scripts:", scripts.length);
    for (const [i, s] of Array.from(scripts).entries()) {
      try {
        if (s.src) {
          // load external script
          console.log(`loadHTML: appending external script [${i}]`, s.src);
          const newScript = document.createElement("script");
          newScript.src = s.src;
          if (s.type) newScript.type = s.type;
          newScript.async = false;
          newScript.dataset.component = selector;
          try {
            document.head.appendChild(newScript);
          } catch (e) {
            console.error("Error appending external script:", s.src, e);
          }
        } else {
          // inline script - sanitize and execute
          let content = s.textContent || s.innerHTML || "";
          content = content
            .replace(/^\s*<!--\s*/, "")
            .replace(/\s*-->\s*$/, "");
          console.log(
            `loadHTML: executing inline script [${i}] length=${content.length}`
          );
          const inline = document.createElement("script");
          if (s.type) inline.type = s.type;
          inline.dataset.component = selector;
          try {
            inline.text = content;
            document.head.appendChild(inline);
          } catch (e) {
            console.error(
              "Error appending inline script for selector",
              selector,
              "content:",
              content.slice(0, 200),
              e
            );
          }
        }
      } catch (e) {
        console.error("Error executing component script", e);
      }
    }

    // mark loaded
    container.dataset.componentLoaded = "true";
    container.dispatchEvent(
      new CustomEvent("component:loaded", { detail: { selector, url } })
    );

    // Try to initialize lucide icons if available
    if (typeof lucide !== "undefined") {
      try {
        lucide.createIcons();
      } catch (e) {}
    }
    console.log("Loaded component", selector, "from", url);
  } catch (error) {
    console.error("Error loading component:", error, "original url:", url);
    // Try several fallback paths to accommodate different hosting setups
    const tryUrls = [
      url,
      url.replace("/components/", "../components/"),
      url.replace("../components/", "components/"),
      url.replace("../", "./"),
      "components/" + url.split("/").pop(),
    ];
    for (const u of tryUrls) {
      try {
        if (!u) continue;
        console.log("loadHTML: fallback trying", u);
        const r = await fetch(u);
        if (!r.ok) {
          console.log("loadHTML: fallback response not ok", r.status, u);
          continue;
        }
        const altHtml = await r.text();
        const container = document.querySelector(selector);
        if (container) container.innerHTML = altHtml;
        console.log("loadHTML: fallback succeeded for", u);
        return;
      } catch (altError) {
        console.warn("loadHTML fallback failed for", u, altError);
      }
    }
    console.error("All loadHTML fallbacks failed for selector", selector);
  }
}

// Initialize app
document.addEventListener("DOMContentLoaded", async function () {
  // Skip authentication on login/signup pages
  const currentPath = window.location.pathname.toLowerCase();
  if (
    currentPath.includes("login.html") ||
    currentPath.includes("signup.html")
  ) {
    return;
  }

  try {
    // Check authentication state
    console.log("Checking authentication on dashboard...");
    
    // FIX: Use getSession() instead of getUser() to handle OAuth redirects correctly
    const { data: { session }, error: authError } = await window.SupabaseConfig.supabase.auth.getSession();

    console.log("Auth result:", {
      user: session?.user ? "exists" : "null",
      error: authError,
    });

    if (authError) {
      console.error("Auth error:", authError);
      throw authError;
    }

    if (!session || !session.user) {
      console.log("No user found, redirecting to login");
      // Redirect to login if not authenticated
      window.location.href = "login.html";
      return;
    }

    const user = session.user;
    console.log("User authenticated:", user.email);

    // Load user profile
    let profile;
    try {
      profile = await window.SupabaseConfig.getUserProfile(user.id);
    } catch (err) {
      // Check if error is because row is missing (PGRST116 is Supabase code for no rows)
      if (err.code === 'PGRST116' || err.status === 406 || (err.message && err.message.includes('JSON object'))) {
        console.log("Profile not found (New OAuth User). Creating profile...");
        
        // Get metadata from Google/Provider
        const meta = user.user_metadata || {};
        // Generate unique username to avoid conflicts
        const rawName = meta.full_name || meta.name || user.email.split('@')[0];
        const cleanName = rawName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 12);
        const username = `${cleanName}_${Math.floor(Math.random() * 10000)}`;
        
        // Check for pending referral code from localStorage
        let referrerId = null;
        const pendingRef = localStorage.getItem('pendingReferral');
        if (pendingRef) {
            const { data: refUser } = await window.SupabaseConfig.supabase
                .from('users')
                .select('id')
                .eq('username', pendingRef)
                .maybeSingle();
            if (refUser) referrerId = refUser.id;
            localStorage.removeItem('pendingReferral');
        }

        // Create new profile in public.users
        const { data: newProfile, error: createErr } = await window.SupabaseConfig.supabase
          .from('users')
          .upsert([{
            id: user.id,
            email: user.email,
            username: username,
            cco_x_balance: 0,
            locked_balance: 0,
            referrer_id: referrerId
          }], { onConflict: 'id' })
          .select()
          .maybeSingle();

        if (createErr) {
            console.error("Profile creation failed:", createErr);
            throw createErr;
        }
        
        // Fallback if select returns null (RLS latency)
        profile = newProfile || {
            id: user.id,
            username: username,
            email: user.email,
            cco_x_balance: 0,
            locked_balance: 0
        };
        showToast("Welcome! Account created successfully.", "success");
      } else {
        throw err;
      }
    }

    currentUser = {
      id: user.id,
      username: profile.username,
      email: profile.email,
      balance: {
        CCOX: profile.ccox_balance || 0,
        USDT: profile.usdt_balance || 0,
      },
    };

    // Load components if they exist
    if (document.querySelector("#sidebar")) {
      await loadHTML("#sidebar", "../components/sidebar.html");
      // Ensure overlay is a direct child of body to avoid stacking/positioning bugs
      const sidebarOverlayEl = document.getElementById("sidebar-overlay");
      if (
        sidebarOverlayEl &&
        sidebarOverlayEl.parentElement &&
        sidebarOverlayEl.parentElement.id === "sidebar"
      ) {
        document.body.appendChild(sidebarOverlayEl);
      }
    }
    if (document.querySelector("#header")) {
      await loadHTML("#header", "../components/header.html");
    }
    if (document.querySelector("#wallet-card")) {
      await loadHTML("#wallet-card", "../components/wallet-card.html");
    }
    if (document.querySelector("#transaction-table")) {
      await loadHTML(
        "#transaction-table",
        "../components/transaction-table.html"
      );
    }

    // Load dashboard data on all authenticated pages to populate sidebar
    loadDashboardData();

    // Update user info in header
    updateUserInfo();

    // Mobile sidebar toggle functionality - now that components are loaded
    const mobileMenuBtn = document.getElementById("mobile-menu-btn");
    const sidebarOverlay = document.getElementById("sidebar-overlay");

    console.log("Setting up sidebar toggle:", {
      mobileMenuBtn,
      sidebarOverlay,
    });

    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener("click", (e) => {
        console.log("Hamburger clicked");
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar();
      });
      console.log("Mobile menu button event listener attached");
    } else {
      console.log("Mobile menu button not found - adding delegated listener");
      document.addEventListener("click", (e) => {
        const target = e.target;
        if (!target) return;
        if (
          target.id === "mobile-menu-btn" ||
          (target.closest && target.closest("#mobile-menu-btn"))
        ) {
          e.preventDefault();
          toggleSidebar();
        }
      });
    }

    if (sidebarOverlay) {
      sidebarOverlay.addEventListener("click", (e) => {
        console.log("Overlay clicked");
        // Only close if clicking directly on overlay, not on sidebar
        if (e.target === sidebarOverlay) {
          toggleSidebar();
        }
      });
      console.log("Sidebar overlay event listener attached");
    } else {
      console.log("Sidebar overlay not found");
    }
  } catch (error) {
    console.error("Authentication error:", error);
    
    // Handle session missing error gracefully (redirect to login)
    if (error.message === "Auth session missing!" || error.name === "AuthSessionMissingError") {
      window.location.href = "login.html";
      return;
    }

    showToast("Auth failed: " + (error.message || "Unknown error"), "error");
    // Only redirect if we're on the dashboard
    if (
      window.location.pathname.includes("index.html") ||
      window.location.pathname === "/" ||
      window.location.pathname.endsWith("/")
    ) {
      setTimeout(() => (window.location.href = "login.html"), 2000);
    }
  }
});

// Update user information in UI
function updateUserInfo() {
  if (!currentUser) return;

  const usernameElements = document.querySelectorAll(".username");
  usernameElements.forEach((el) => (el.textContent = currentUser.username));

  // Note: Balance is now loaded from database in loadDashboardData()
}

// Show toast notification
function showToast(message, type = "success") {
  // Simple toast implementation
  const toast = document.createElement("div");
  toast.className = `fixed top-4 right-4 px-4 py-2 rounded-lg text-white z-50 ${
    type === "success" ? "bg-green-500" : "bg-red-500"
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    document.body.removeChild(toast);
  }, 3000);
}

// Utility functions
function formatCurrency(amount, currency = "CCOX") {
  return `${amount.toFixed(2)} ${currency}`;
}

function formatDate(date) {
  return new Date(date).toLocaleString();
}

// Auth functions
async function logout() {
  try {
    await window.SupabaseConfig.signOut();
    currentUser = null;
    window.location.href = "login.html";
  } catch (error) {
    console.error("Logout failed:", error);
    showToast("Logout failed", "error");
  }
}

// Load dashboard data from database
async function loadDashboardData() {
  if (!currentUser) return;

  try {
    // Load user stats
    const { data: userStats, error: statsError } =
      await window.SupabaseConfig.supabase
        .from("users")
        .select("cco_x_balance, green_balance, usdt_balance, locked_balance")
        .eq("id", currentUser.id)
        .single();

    if (!statsError && userStats) {
      console.log("loadDashboardData: fetched userStats", userStats);
      const unlocked = Number(userStats.cco_x_balance || 0);
      const locked = Number(userStats.locked_balance || 0);

      // Update unlocked wallet balance display used across pages
      const balanceElements = document.querySelectorAll(".balance-ccox");
      balanceElements.forEach((el) => (el.textContent = unlocked.toFixed(2)));

      // Update wallet-balance and wallet-val if present
      const walletEl = document.getElementById("wallet-balance");
      if (walletEl) walletEl.textContent = unlocked.toFixed(2);
      const walletValEl = document.getElementById("wallet-val");
      if (walletValEl) walletValEl.textContent = `${unlocked.toFixed(2)} CCOX`;

      // Update locked balance displays (multiple id variants across pages)
      const lockedEl = document.getElementById("locked-balance");
      if (lockedEl) lockedEl.textContent = locked.toFixed(2);
      const lockedValEl = document.getElementById("locked-val");
      if (lockedValEl) lockedValEl.textContent = `${locked.toFixed(2)} CCOX`;

      // Mirror locked balance to localStorage for the inline dashboard/mining scripts
      try {
        localStorage.setItem("ccox_locked", locked.toString());
        // Dispatch a global event so pages can update immediately
        window.dispatchEvent(
          new CustomEvent("ccox:balances-updated", { detail: { locked } })
        );
      } catch (e) {
        console.warn("Could not write ccox_locked to localStorage", e);
      }
    }

    // Load total users count
    const { count: totalUsers, error: countError } =
      await window.SupabaseConfig.supabase
        .from("users")
        .select("*", { count: "exact", head: true });

    if (!countError) {
      const totalUsersElements = document.querySelectorAll(".total-users");
      totalUsersElements.forEach((el) => (el.textContent = totalUsers || 0));
    }

    // Load total shared posts (assuming a posts table exists)
    const { count: totalShares, error: sharesError } =
      await window.SupabaseConfig.supabase
        .from("posts")
        .select("*", { count: "exact", head: true });

    if (!sharesError) {
      const totalSharesElements = document.querySelectorAll(".total-shares");
      totalSharesElements.forEach((el) => (el.textContent = totalShares || 0));
    }

    // Load current streak (simplified - you might want to implement proper streak tracking)
    const streakElements = document.querySelectorAll(".current-streak");
    streakElements.forEach((el) => (el.textContent = "0 days"));
  } catch (error) {
    console.error("Error loading dashboard data:", error);
  }
}
