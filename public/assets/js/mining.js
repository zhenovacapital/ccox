// Mining functionality
document.addEventListener("DOMContentLoaded", function () {
  console.log("Mining page loaded");

  const startMiningBtn = document.getElementById("start-mining-btn");
  const stopMiningBtn = document.getElementById("stop-mining-btn");
  const miningStatus = document.getElementById("mining-status");
  const hashrate = document.getElementById("hashrate");
  const lockedBalance = document.getElementById("locked-balance");
  const walletBalance = document.getElementById("wallet-balance");
  const miningProgress = document.getElementById("mining-progress");
  const progressPercent = document.getElementById("progress-percent");

  console.log("Button found:", !!startMiningBtn);
  console.log("Stop button found:", !!stopMiningBtn);
  console.log("Supabase config:", !!window.SupabaseConfig);
  console.log(
    "Supabase auth:",
    !!(window.SupabaseConfig && window.SupabaseConfig.supabase)
  );

  let miningInterval;
  let miningStartTime;
  let isMining = false;
  let currentUser = null;

  // Check authentication and mining status
  if (window.SupabaseConfig && window.SupabaseConfig.supabase) {
    window.SupabaseConfig.supabase.auth.onAuthStateChange((event, session) => {
      console.log("Auth state changed:", event, !!session?.user);
      currentUser = session?.user || null;
      if (!currentUser) {
        // Redirect to login if not authenticated
        console.log("No user, redirecting to login");
        window.location.href = "login.html";
      } else {
        console.log("User authenticated:", currentUser.email);
        // Check if mining is already in progress from dashboard
        checkMiningStatusFromDashboard();
      }
    });
  } else {
    console.error("Supabase not initialized!");
  }

  // Start mining function for the new button
  window.startMining = async function () {
    console.log(
      "Start mining clicked - isMining:",
      isMining,
      "currentUser:",
      !!currentUser
    );

    if (isMining) {
      console.log("Cannot start mining - already mining");
      showToast("Mining is already active", "info");
      return;
    }

    if (!currentUser) {
      console.log("Cannot start mining - user not logged in");
      showToast("Please log in first", "error");
      return;
    }

    try {
      console.log("Starting mining for user:", currentUser.id);

      // Start mining session in database and use server-sourced end time
      const resp = await window.SupabaseConfig.startMining(currentUser.id);
      if (!resp || !resp.success) {
        showToast("Failed to start mining", "error");
        return;
      }

      // Determine end time (server provides ISO `ends_at` when available)
      const MINING_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      const endTime = resp.ends_at
        ? Date.parse(resp.ends_at)
        : Date.now() + MINING_DURATION;

      isMining = true;
      miningStartTime = Date.now();
      const miningStatusText = document.getElementById("miningStatusText");
      if (miningStatusText) miningStatusText.textContent = "Mining Active";
      const miningBtn = document.getElementById("miningBtn");
      if (miningBtn) miningBtn.classList.add("disabled");

      // Persist end time (client cache only)
      localStorage.setItem("miningEndTime", endTime.toString());

      console.log("Mining started - will end at:", new Date(endTime));

      // Update mining progress based on authoritative end time
      miningInterval = setInterval(() => {
        const now = Date.now();
        const timeRemaining = endTime - now;

        if (timeRemaining <= 0) {
          clearInterval(miningInterval);
          completeMining();
          return;
        }

        const progress =
          ((MINING_DURATION - timeRemaining) / MINING_DURATION) * 100;

        if (miningProgress) miningProgress.style.width = progress + "%";
        if (progressPercent)
          progressPercent.textContent = Math.round(progress) + "%";
        if (hashrate)
          hashrate.textContent =
            (Math.random() * 100 + 50).toFixed(1) + " MH/s";

        // Update timer
        const miningTimer = document.getElementById("miningTimer");
        if (miningTimer) {
          const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
          const minutes = Math.floor(
            (timeRemaining % (1000 * 60 * 60)) / (1000 * 60)
          );
          miningTimer.textContent = `${hours}h ${minutes}m remaining`;
        }
      }, 1000);
    } catch (error) {
      console.error("Mining error:", error);
      showToast("Failed to start mining: " + (error.message || error), "error");
    }
  };

  // Legacy start mining button (if exists)
  if (startMiningBtn) {
    startMiningBtn.addEventListener("click", window.startMining);
  }

  // Stop mining
  if (stopMiningBtn) {
    stopMiningBtn.addEventListener("click", function () {
      if (!isMining) return;

      clearInterval(miningInterval);
      isMining = false;
      const miningStatusText = document.getElementById("miningStatusText");
      if (miningStatusText) miningStatusText.textContent = "Start Mining";
      const miningBtn = document.getElementById("miningBtn");
      if (miningBtn) miningBtn.classList.remove("disabled");
      if (miningStatus) miningStatus.textContent = "Inactive";
      if (miningStatus)
        miningStatus.className = "text-2xl font-bold text-red-400";
      if (startMiningBtn) startMiningBtn.disabled = false;
      if (stopMiningBtn) stopMiningBtn.disabled = true;
      if (miningProgress) miningProgress.style.width = "0%";
      if (progressPercent) progressPercent.textContent = "0%";
      if (hashrate) hashrate.textContent = "0.0 MH/s";
    });
  }

  // Complete mining session
  async function completeMining() {
    if (!currentUser) return;

    try {
      clearInterval(miningInterval);
      isMining = false;
      if (miningStatus) miningStatus.textContent = "Inactive";
      if (miningStatus)
        miningStatus.className = "text-2xl font-bold text-red-400";
      if (startMiningBtn) startMiningBtn.disabled = false;
      if (stopMiningBtn) stopMiningBtn.disabled = true;
      if (miningProgress) miningProgress.style.width = "0%";
      if (progressPercent) progressPercent.textContent = "0%";
      if (hashrate) hashrate.textContent = "0.0 MH/s";

      // Complete mining session in database
      const result = await window.SupabaseConfig.completeMining(currentUser.id);
      console.log("Mining completed result:", result);

      // Add reward to locked balance
      console.log(
        "About to add to locked balance - userId:",
        currentUser.id,
        "amount:",
        result.reward
      );
      const newLockedBalance = await window.SupabaseConfig.addToLockedBalance(
        currentUser.id,
        result.reward
      );
      console.log("New locked balance after mining:", newLockedBalance);
      console.log("Locked balance element:", lockedBalance);

      // Update UI immediately with new locked balance
      if (lockedBalance)
        lockedBalance.textContent = newLockedBalance.toFixed(2);

      // Check if locked balance >= 50 and auto-swap to wallet
      const userProfile = await window.SupabaseConfig.getUserProfile(
        currentUser.id
      );
      const lockedVal = Number(newLockedBalance);
      console.log("User profile after mining:", userProfile);

      if (lockedVal >= 50) {
        // Auto-swap to wallet when locked balance reaches 50
        await window.SupabaseConfig.swapToWallet(currentUser.id, lockedVal);
        showToast(
          `Mining completed! +${result.reward} CCOX added to locked balance. Auto-swapped ${lockedVal} CCOX to wallet!`,
          "success"
        );
      } else {
        showToast(
          `Mining completed! +${result.reward} CCOX added to locked balance (${lockedVal}/50 for auto-swap)`,
          "success"
        );
      }

      // Update wallet balance UI
      const walletVal =
        userProfile && userProfile.cco_x_balance
          ? Number(userProfile.cco_x_balance)
          : 0;
      if (walletBalance) walletBalance.textContent = walletVal.toFixed(2);

      // Refresh mining history to show the completed session
      loadMiningHistory();
    } catch (error) {
      showToast("Failed to complete mining: " + error.message, "error");
    }
  }

  // Load user data on page load
  async function loadUserData() {
    if (!currentUser) return;

    try {
      const userProfile = await window.SupabaseConfig.getUserProfile(
        currentUser.id
      );
      if (lockedBalance)
        lockedBalance.textContent = (userProfile.locked_balance || 0).toFixed(
          2
        );
      if (walletBalance)
        walletBalance.textContent = (userProfile.cco_x_balance || 0).toFixed(2);

      // Load mining history
      loadMiningHistory();
    } catch (error) {
      console.error("Failed to load user data:", error);
    }
  }

  // Load mining history
  async function loadMiningHistory() {
    if (!currentUser) return;

    try {
      const { data: miningSessions, error } =
        await window.SupabaseConfig.supabase
          .from("mining_sessions")
          .select("*")
          .eq("user_id", currentUser.id)
          .order("started_at", { ascending: false })
          .limit(10);

      if (error) throw error;

      const miningHistoryTable = document.getElementById(
        "mining-history-table"
      );
      if (!miningHistoryTable) return;

      miningHistoryTable.innerHTML = "";

      if (!miningSessions || miningSessions.length === 0) {
        miningHistoryTable.innerHTML = `
          <tr>
            <td colspan="4" class="text-center text-gray-500 py-4">No mining history yet</td>
          </tr>
        `;
        return;
      }

      miningSessions.forEach((session) => {
        const startDate = new Date(session.started_at).toLocaleDateString();
        const duration = session.completed_at
          ? Math.round(
              (new Date(session.completed_at) - new Date(session.started_at)) /
                (1000 * 60 * 60)
            ) + "h"
          : "In Progress";
        const reward = session.reward_amount || 0;
        const status =
          session.status.charAt(0).toUpperCase() + session.status.slice(1);

        const row = document.createElement("tr");
        row.className = "border-b border-gray-700";
        row.innerHTML = `
          <td class="py-2 px-4">${startDate}</td>
          <td class="py-2 px-4">${duration}</td>
          <td class="py-2 px-4">${reward.toFixed(2)} CCOX</td>
          <td class="py-2 px-4">
            <span class="px-2 py-1 rounded text-xs ${
              status === "Completed"
                ? "bg-green-600 text-white"
                : status === "Active"
                ? "bg-blue-600 text-white"
                : "bg-gray-600 text-white"
            }">${status}</span>
          </td>
        `;
        miningHistoryTable.appendChild(row);
      });
    } catch (error) {
      console.error("Failed to load mining history:", error);
    }
  }

  // Load data when user is authenticated
  window.SupabaseConfig.supabase.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user || null;
    if (currentUser) {
      loadUserData();
    }
  });

  // Swap functionality removed - not supported by current database schema

  // Check mining status from dashboard
  function checkMiningStatusFromDashboard() {
    (async () => {
      const MINING_DURATION = 24 * 60 * 60 * 1000;

      try {
        // 1) Prefer server as source of truth: resume any active mining session
        if (
          currentUser &&
          window.SupabaseConfig &&
          window.SupabaseConfig.getActiveMiningSession
        ) {
          try {
            const active = await window.SupabaseConfig.getActiveMiningSession(
              currentUser.id
            );
            if (active) {
              const startedAt = Date.parse(active.started_at);
              const endTime = startedAt + MINING_DURATION;
              const now = Date.now();

              if (now < endTime) {
                isMining = true;
                const miningStatusText =
                  document.getElementById("miningStatusText");
                if (miningStatusText)
                  miningStatusText.textContent = "Mining Active";
                const miningBtn = document.getElementById("miningBtn");
                if (miningBtn) miningBtn.classList.add("disabled");
                if (miningStatus) miningStatus.textContent = "Active";
                if (miningStatus)
                  miningStatus.className = "text-2xl font-bold text-green-400";
                if (startMiningBtn) startMiningBtn.disabled = true;
                if (stopMiningBtn) stopMiningBtn.disabled = false;

                // resume progress
                if (miningInterval) clearInterval(miningInterval);
                miningInterval = setInterval(() => {
                  const currentTime = Date.now();
                  const timeRemaining = endTime - currentTime;

                  if (timeRemaining <= 0) {
                    clearInterval(miningInterval);
                    completeMining();
                    return;
                  }

                  const progress =
                    ((MINING_DURATION - timeRemaining) / MINING_DURATION) * 100;
                  if (miningProgress)
                    miningProgress.style.width = progress + "%";
                  if (progressPercent)
                    progressPercent.textContent = Math.round(progress) + "%";
                  if (hashrate)
                    hashrate.textContent =
                      (Math.random() * 100 + 50).toFixed(1) + " MH/s";
                }, 1000);
                return;
              } else {
                // server session expired
                try {
                  if (currentUser && currentUser.id)
                    localStorage.removeItem("miningEndTime_" + currentUser.id);
                } catch (e) {}
                showToast(
                  "Mining completed while you were away! Check dashboard to claim reward.",
                  "success"
                );
                return;
              }
            }
          } catch (e) {
            console.warn("Failed to fetch active mining session:", e);
          }
        }

        // 2) Fallback: per-user localStorage cache (legacy)
        let miningEndTime = null;
        try {
          if (currentUser && currentUser.id)
            miningEndTime = localStorage.getItem(
              "miningEndTime_" + currentUser.id
            );
          if (!miningEndTime)
            miningEndTime = localStorage.getItem("miningEndTime");
        } catch (e) {
          console.warn("localStorage unavailable:", e);
        }

        if (miningEndTime) {
          const endTime = parseInt(miningEndTime);
          const now = Date.now();

          if (now < endTime) {
            isMining = true;
            const miningStatusText =
              document.getElementById("miningStatusText");
            if (miningStatusText)
              miningStatusText.textContent = "Mining Active";
            const miningBtn = document.getElementById("miningBtn");
            if (miningBtn) miningBtn.classList.add("disabled");
            if (miningStatus) miningStatus.textContent = "Active";
            if (miningStatus)
              miningStatus.className = "text-2xl font-bold text-green-400";
            if (startMiningBtn) startMiningBtn.disabled = true;
            if (stopMiningBtn) stopMiningBtn.disabled = false;

            if (miningInterval) clearInterval(miningInterval);
            miningInterval = setInterval(() => {
              const currentTime = Date.now();
              const timeRemaining = endTime - currentTime;

              if (timeRemaining <= 0) {
                clearInterval(miningInterval);
                completeMining();
                return;
              }

              const progress =
                ((MINING_DURATION - timeRemaining) / MINING_DURATION) * 100;
              if (miningProgress) miningProgress.style.width = progress + "%";
              if (progressPercent)
                progressPercent.textContent = Math.round(progress) + "%";
              if (hashrate)
                hashrate.textContent =
                  (Math.random() * 100 + 50).toFixed(1) + " MH/s";
            }, 1000);
          } else {
            try {
              if (currentUser && currentUser.id)
                localStorage.removeItem("miningEndTime_" + currentUser.id);
              else localStorage.removeItem("miningEndTime");
            } catch (e) {}
            showToast(
              "Mining completed while you were away! Check dashboard to claim reward.",
              "success"
            );
          }
        }
      } catch (err) {
        console.error("Error checking mining status:", err);
      }
    })();
  }
});
