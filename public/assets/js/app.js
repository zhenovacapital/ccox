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
  // If overlay missing, create one and append to body
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
    const response = await fetch(url);
    const html = await response.text();
    document.querySelector(selector).innerHTML = html;
  } catch (error) {
    console.error("Error loading component:", error);
    // Fallback: try alternative path
    try {
      const altUrl = url.replace("/components/", "../components/");
      const altResponse = await fetch(altUrl);
      const altHtml = await altResponse.text();
      document.querySelector(selector).innerHTML = altHtml;
    } catch (altError) {
      console.error("Error loading component with alternative path:", altError);
    }
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
    const {
      data: { session },
      error: authError,
    } = await window.SupabaseConfig.supabase.auth.getSession();

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
        const rawName = meta.user_name || meta.full_name || meta.name || user.email.split('@')[0];
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

        // Create new profile in public.users using upsert
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
      // Ensure icons are rendered for injected header/sidebar
      await ensureLucide();
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

    // Prefer direct binding, but also add delegation so button works if rendered later
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
    showToast("Authentication failed", "error");
    // Only redirect if we're on the dashboard
    if (
      window.location.pathname.includes("dashboard.html") ||
      window.location.pathname === "/" ||
      window.location.pathname.endsWith("/")
    ) {
      setTimeout(() => (window.location.href = "login.html"), 2000);
    }
  }
});

async function handleSocialLogin(provider) {
    try {
      await window.SupabaseConfig.signInWithProvider(provider);
    } catch (error) {
      showToast("Login failed: " + error.message, "error");
    }
  }


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
        .select("cco_x_balance, green_balance, usdt_balance")
        .eq("id", currentUser.id)
        .single();

    if (!statsError && userStats) {
      // Update balance display
      const balanceElements = document.querySelectorAll(".balance-ccox");
      balanceElements.forEach(
        (el) => (el.textContent = userStats.cco_x_balance?.toFixed(2) || "0.00")
      );
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

// Fix for missing getKYCStatus in some environments
if (typeof window.SupabaseConfig !== 'undefined' && !window.SupabaseConfig.getKYCStatus) {
  window.SupabaseConfig.getKYCStatus = async function (userId) {
    try {
      const { data } = await window.SupabaseConfig.supabase
        .from("kyc_applications")
        .select("status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? data.status : null;
    } catch (e) {
      console.error("getKYCStatus error:", e);
      return null;
    }
  };
}
