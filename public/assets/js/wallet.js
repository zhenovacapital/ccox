// Wallet page logic
document.addEventListener('DOMContentLoaded', function() {
  if (window.location.pathname.includes('wallet.html')) {
    initializeWallet();
  }
});

function initializeWallet() {
  // Load demo transaction history
  loadTransactionHistory();

  // Setup modal handlers
  setupModalHandlers();
}

function loadTransactionHistory() {
  const demoTransactions = [
    { id: 1, type: 'receive', title: 'Received CCOX', amount: 100.50, currency: 'CCOX', date: '2023-12-01T10:00:00Z', status: 'completed' },
    { id: 2, type: 'send', title: 'Sent to user@example.com', amount: -50.00, currency: 'CCOX', date: '2023-11-30T15:30:00Z', status: 'completed' },
    { id: 3, type: 'mining', title: 'Mining Reward', amount: 25.75, currency: 'GREEN', date: '2023-11-29T08:00:00Z', status: 'completed' },
    { id: 4, type: 'deposit', title: 'USDT Deposit', amount: 200.00, currency: 'USDT', date: '2023-11-28T12:00:00Z', status: 'pending' }
  ];

  const tableBody = document.querySelector('#transaction-table tbody');
  if (tableBody) {
    tableBody.innerHTML = demoTransactions.map(tx => `
      <tr class="border-b border-gray-700">
        <td class="py-3 px-4">
          <div class="flex items-center">
            <div class="w-8 h-8 bg-${tx.type === 'receive' ? 'green' : tx.type === 'send' ? 'red' : 'blue'}-500 rounded-full flex items-center justify-center mr-3">
              <span class="text-white text-sm">${tx.type.charAt(0).toUpperCase()}</span>
            </div>
            <span>${tx.title}</span>
          </div>
        </td>
        <td class="py-3 px-4">${formatDate(tx.date)}</td>
        <td class="py-3 px-4 ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}">${formatCurrency(Math.abs(tx.amount), tx.currency)}</td>
        <td class="py-3 px-4">
          <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${tx.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">
            ${tx.status}
          </span>
        </td>
      </tr>
    `).join('');
  }
}

function setupModalHandlers() {
  // Send modal
  const sendBtn = document.querySelector('#send-btn');
  const sendModal = document.querySelector('#send-modal');
  const sendForm = document.querySelector('#send-form');

  if (sendBtn && sendModal) {
    sendBtn.addEventListener('click', () => sendModal.classList.remove('hidden'));
    document.querySelector('#close-send-modal').addEventListener('click', () => sendModal.classList.add('hidden'));
  }

  if (sendForm) {
    sendForm.addEventListener('submit', handleSend);
  }

  // Other modals (Receive, Deposit, Withdraw) - similar setup
  // ... (omitted for brevity, but would be similar)
}

async function handleSend(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const recipient = formData.get('recipient');
  const amount = parseFloat(formData.get('amount'));
  const currency = formData.get('currency');

  // Show confirmation step
  showSendConfirmation(recipient, amount, currency);
}

function showSendConfirmation(recipient, amount, currency) {
  // Implementation for 2-step confirmation
  // ... (show confirmation modal with details)
  // On confirm, call internalTransfer and update UI optimistically
  showToast('Transaction initiated successfully!', 'success');
}

// Copy wallet address
function copyWalletAddress() {
  const address = document.querySelector('#wallet-address').textContent;
  navigator.clipboard.writeText(address);
  showToast('Wallet address copied!', 'success');
}

// View wallet QR
function viewWalletQR() {
  // Show QR modal
  showToast('QR Code displayed!', 'success');
}
