// import frame work utils
const validator = require('@app-core/validator');
const { throwAppError, ERROR_CODE } = require('@app-core/errors');
const { appLogger } = require('@app-core/logger');
const PaymentMessages = require('@app/messages/payment');

// Define input validation spec and parse instruction string
const inputSpec = `root {
    accounts[] {
        id string
        balance number
        currency string
    }
    instruction string
}`;
// parse the spec once when server starts
const parsedInputSpec = validator.parse(inputSpec);

// normalize spaces in instruction string
function normalizeSpaces(string) {
  return string
    .split(' ')
    .filter((word) => word.length > 0)
    .join(' ');
}

// validate account ID format
function isValidAccountId(accountId) {
  // check character
  for (let i = 0; i < accountId.length; i++) {
    const char = accountId.charAt(i);
    const isLetter = (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z');
    const isDigit = char >= '0' && char <= '9';
    const isAllowedSymbol = char === '_' || char === '-';
    if (!isLetter && !isDigit && !isAllowedSymbol) {
      return false;
    }
  }
  return true;
}

// validate if amount is positive number
function isValidAmount(amountStr) {
  if (amountStr.length === 0) return false;
  // check for decimal point
  if (amountStr.includes('.')) return false;
  // check for negative sign
  if (amountStr.includes('-')) return false;

  // check all characters are digits
  for (let i = 0; i < amountStr.length; i++) {
    const char = amountStr[i];
    if (char < '0' || char > '9') {
      return false;
    }
  }

  // check if its not 0
  const amountNum = parseInt(amountStr, 10);
  return amountNum > 0;
}

// validate currency code format
function isValidCurrencyCode(currency) {
  const validCurrencies = ['USD', 'GBP', 'GHS', 'NGN'];
  return validCurrencies.includes(currency.toUpperCase());
}

// validate date format YYYY-MM-DD
function isValidDateFormat(dateStr) {
  // format:yyyy-mm-dd(10 chars)
  if (dateStr.length !== 10) return false;
  // check position 4 and 7 are hyphens
  if (dateStr.charAt(4) !== '-' || dateStr.charAt(7) !== '-') return false;
  const yearStr = dateStr.substring(0, 4);
  const monthStr = dateStr.substring(5, 7);
  const dayStr = dateStr.substring(8, 10);
  // check year, month, day are numbers
  for (const char of yearStr) {
    if (char < '0' || char > '9') return false;
  }
  for (const char of monthStr) {
    if (char < '0' || char > '9') return false;
  }
  for (const char of dayStr) {
    if (char < '0' || char > '9') return false;
  }
  // check ramges
  const y = parseInt(yearStr);
  const m = parseInt(monthStr);
  const d = parseInt(dayStr);

  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;

  return true;
}

// compare dates in format YYYY-MM-DD
function isDateInFuture(dateStr) {
  // get todays date in UTC
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const parts = dateStr.split('-');
  const instructionDate = new Date(
    Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
  );

  return instructionDate > todayUTC;
}

// parse validationSpec once, when server starts

async function parseInstruction(serviceData, options = {}) {
  let response;
  //   validate input data
  const data = validator.validate(serviceData, parsedInputSpec);

  appLogger.info(
    {
      instruction: data.instruction,
      accountCount: data.accounts.length,
    },
    'parse-instruction-start'
  );
  try {
    // normalize and prepare instruction
    const instruction = data.instruction.trim();
    const normalizedInstruction = normalizeSpaces(instruction.toUpperCase());
    // split into words
    const words = normalizedInstruction.split(' ');

    appLogger.info({ words, wordCount: words.length }, 'instruction-words');

    // initialize parsing result

    let type = null;
    let amount = null;
    let currency = null;
    let debitAccountId = null;
    let creditAccountId = null;
    let executeBy = null;

    // Determine instruction type
    if (words[0] === 'DEBIT') {
      type = 'DEBIT';
    } else if (words[0] === 'CREDIT') {
      type = 'CREDIT';
    } else {
      response = {
        type: null,
        amount: null,
        currency: null,
        debit_account: null,
        credit_account: null,
        execute_by: null,
        status: 'failed',
        status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
        status_code: 'SY03',
        accounts: [],
      };
      return response;
    }

    // Parse based on type
    const originalWords = normalizeSpaces(instruction).split(' ');

    if (type === 'DEBIT') {
      // DEBIT [amount] [currency] FROM ACCOUNT [id] FOR CREDIT TO ACCOUNT [id] [ON [date]]
      if (words.length < 11) {
        response = {
          type: 'DEBIT',
          amount: null,
          currency: null,
          debit_account: null,
          credit_account: null,
          execute_by: null,
          status: 'failed',
          status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
          status_code: 'SY03',
          accounts: [],
        };
        return response;
      }

      const amountStr = words[1];
      currency = originalWords[2].toUpperCase();

      if (words[3] !== 'FROM' || words[4] !== 'ACCOUNT') {
        response = {
          type: 'DEBIT',
          amount: null,
          currency,
          debit_account: null,
          credit_account: null,
          execute_by: null,
          status: 'failed',
          status_reason:
            words[3] !== 'FROM'
              ? PaymentMessages.INVALID_KEYWORD_ORDER
              : PaymentMessages.MISSING_KEYWORD,
          status_code: words[3] !== 'FROM' ? 'SY02' : 'SY01',
          accounts: [],
        };
        return response;
      }

      debitAccountId = originalWords[5];

      if (
        words[6] !== 'FOR' ||
        words[7] !== 'CREDIT' ||
        words[8] !== 'TO' ||
        words[9] !== 'ACCOUNT'
      ) {
        response = {
          type: 'DEBIT',
          amount: null,
          currency,
          debit_account: debitAccountId,
          credit_account: null,
          execute_by: null,
          status: 'failed',
          status_reason:
            words[6] !== 'FOR' || words[8] !== 'TO'
              ? PaymentMessages.INVALID_KEYWORD_ORDER
              : PaymentMessages.MISSING_KEYWORD,
          status_code: words[6] !== 'FOR' || words[8] !== 'TO' ? 'SY02' : 'SY01',
          accounts: [],
        };
        return response;
      }

      creditAccountId = originalWords[10];

      if (words.length >= 13 && words[11] === 'ON') {
        executeBy = originalWords[12];
      }

      if (!isValidAmount(amountStr)) {
        response = {
          type: 'DEBIT',
          amount: null,
          currency,
          debit_account: debitAccountId,
          credit_account: creditAccountId,
          execute_by: executeBy,
          status: 'failed',
          status_reason: PaymentMessages.INVALID_AMOUNT,
          status_code: 'AM01',
          accounts: [],
        };
        return response;
      }

      amount = parseInt(amountStr, 10);
    } else if (type === 'CREDIT') {
      // CREDIT [amount] [currency] TO ACCOUNT [id] FOR DEBIT FROM ACCOUNT [id] [ON [date]]
      if (words.length < 11) {
        response = {
          type: 'CREDIT',
          amount: null,
          currency: null,
          debit_account: null,
          credit_account: null,
          execute_by: null,
          status: 'failed',
          status_reason: PaymentMessages.MALFORMED_INSTRUCTION,
          status_code: 'SY03',
          accounts: [],
        };
        return response;
      }

      const amountStr = words[1];
      currency = originalWords[2].toUpperCase();

      if (words[3] !== 'TO' || words[4] !== 'ACCOUNT') {
        response = {
          type: 'CREDIT',
          amount: null,
          currency,
          debit_account: null,
          credit_account: null,
          execute_by: null,
          status: 'failed',
          status_reason:
            words[3] !== 'TO'
              ? PaymentMessages.INVALID_KEYWORD_ORDER
              : PaymentMessages.MISSING_KEYWORD,
          status_code: words[3] !== 'TO' ? 'SY02' : 'SY01',
          accounts: [],
        };
        return response;
      }

      creditAccountId = originalWords[5];

      if (
        words[6] !== 'FOR' ||
        words[7] !== 'DEBIT' ||
        words[8] !== 'FROM' ||
        words[9] !== 'ACCOUNT'
      ) {
        response = {
          type: 'CREDIT',
          amount: null,
          currency,
          debit_account: null,
          credit_account: creditAccountId,
          execute_by: null,
          status: 'failed',
          status_reason:
            words[6] !== 'FOR' || words[8] !== 'FROM'
              ? PaymentMessages.INVALID_KEYWORD_ORDER
              : PaymentMessages.MISSING_KEYWORD,
          status_code: words[6] !== 'FOR' || words[8] !== 'FROM' ? 'SY02' : 'SY01',
          accounts: [],
        };
        return response;
      }

      debitAccountId = originalWords[10];

      if (words.length >= 13 && words[11] === 'ON') {
        executeBy = originalWords[12];
      }

      if (!isValidAmount(amountStr)) {
        response = {
          type: 'CREDIT',
          amount: null,
          currency,
          debit_account: debitAccountId,
          credit_account: creditAccountId,
          execute_by: executeBy,
          status: 'failed',
          status_reason: PaymentMessages.INVALID_AMOUNT,
          status_code: 'AM01',
          accounts: [],
        };
        return response;
      }

      amount = parseInt(amountStr, 10);
    }

    appLogger.info(
      {
        type,
        amount,
        currency,
        debitAccountId,
        creditAccountId,
        executeBy,
      },
      'instruction-parsed'
    );

    // ✅ NOW ADD: VALIDATION PHASE

    // Validate account ID formats
    if (!isValidAccountId(debitAccountId)) {
      response = {
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.INVALID_ACCOUNT_ID,
        status_code: 'AC04',
        accounts: [],
      };
      return response;
    }

    if (!isValidAccountId(creditAccountId)) {
      response = {
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.INVALID_ACCOUNT_ID,
        status_code: 'AC04',
        accounts: [],
      };
      return response;
    }

    // Validate currency is supported
    if (!isValidCurrencyCode(currency)) {
      response = {
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.UNSUPPORTED_CURRENCY,
        status_code: 'CU02',
        accounts: [],
      };
      return response;
    }

    // Validate date format if provided
    if (executeBy !== null) {
      if (!isValidDateFormat(executeBy)) {
        response = {
          type,
          amount,
          currency,
          debit_account: debitAccountId,
          credit_account: creditAccountId,
          execute_by: executeBy,
          status: 'failed',
          status_reason: PaymentMessages.INVALID_DATE_FORMAT,
          status_code: 'DT01',
          accounts: [],
        };
        return response;
      }
    }

    // Find accounts in the provided accounts array
    const debitAccount = data.accounts.find((acc) => acc.id === debitAccountId);
    const creditAccount = data.accounts.find((acc) => acc.id === creditAccountId);

    // Check accounts exist
    if (!debitAccount) {
      response = {
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.ACCOUNT_NOT_FOUND,
        status_code: 'AC03',
        accounts: [],
      };
      return response;
    }

    if (!creditAccount) {
      response = {
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.ACCOUNT_NOT_FOUND,
        status_code: 'AC03',
        accounts: [],
      };
      return response;
    }

    // Check accounts are different
    if (debitAccountId === creditAccountId) {
      const responseAccounts = [];
      for (const acc of data.accounts) {
        if (acc.id === debitAccountId) {
          responseAccounts.push({
            id: acc.id,
            balance: acc.balance,
            balance_before: acc.balance,
            currency: acc.currency.toUpperCase(),
          });
        }
      }

      response = {
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.SAME_ACCOUNT_ERROR,
        status_code: 'AC02',
        accounts: responseAccounts,
      };
      return response;
    }

    // Check currency match
    if (debitAccount.currency.toUpperCase() !== creditAccount.currency.toUpperCase()) {
      const responseAccounts = [];
      for (const acc of data.accounts) {
        if (acc.id === debitAccountId || acc.id === creditAccountId) {
          responseAccounts.push({
            id: acc.id,
            balance: acc.balance,
            balance_before: acc.balance,
            currency: acc.currency.toUpperCase(),
          });
        }
      }

      response = {
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.CURRENCY_MISMATCH,
        status_code: 'CU01',
        accounts: responseAccounts,
      };
      return response;
    }

    // Check sufficient funds
    if (debitAccount.balance < amount) {
      const responseAccounts = [];
      for (const acc of data.accounts) {
        if (acc.id === debitAccountId || acc.id === creditAccountId) {
          responseAccounts.push({
            id: acc.id,
            balance: acc.balance,
            balance_before: acc.balance,
            currency: acc.currency.toUpperCase(),
          });
        }
      }

      response = {
        type,
        amount,
        currency,
        debit_account: debitAccountId,
        credit_account: creditAccountId,
        execute_by: executeBy,
        status: 'failed',
        status_reason: PaymentMessages.INSUFFICIENT_FUNDS,
        status_code: 'AC01',
        accounts: responseAccounts,
      };
      return response;
    }

    // ✅ NOW ADD: EXECUTION PHASE

    appLogger.info('validation-passed-executing-transaction');

    // Check if should execute immediately or pending
    let shouldExecute = true;
    let status = 'successful';
    let statusCode = 'AP00';

    if (executeBy !== null) {
      if (isDateInFuture(executeBy)) {
        shouldExecute = false;
        status = 'pending';
        statusCode = 'AP02';
      }
    }

    // Calculate new balances
    let newDebitBalance = debitAccount.balance;
    let newCreditBalance = creditAccount.balance;

    if (shouldExecute) {
      newDebitBalance = debitAccount.balance - amount;
      newCreditBalance = creditAccount.balance + amount;

      appLogger.info(
        {
          debitAccountId,
          oldBalance: debitAccount.balance,
          newBalance: newDebitBalance,
          creditAccountId,
          oldCreditBalance: creditAccount.balance,
          newCreditBalance,
        },
        'transaction-executed'
      );
    } else {
      appLogger.info({ executeBy }, 'transaction-pending');
    }

    // Build response accounts array (maintain original order)
    const responseAccounts = [];
    for (const acc of data.accounts) {
      if (acc.id === debitAccountId) {
        responseAccounts.push({
          id: acc.id,
          balance: newDebitBalance,
          balance_before: acc.balance,
          currency: acc.currency.toUpperCase(),
        });
      } else if (acc.id === creditAccountId) {
        responseAccounts.push({
          id: acc.id,
          balance: newCreditBalance,
          balance_before: acc.balance,
          currency: acc.currency.toUpperCase(),
        });
      }
    }

    response = {
      type,
      amount,
      currency: currency.toUpperCase(),
      debit_account: debitAccountId,
      credit_account: creditAccountId,
      execute_by: executeBy,
      status,
      status_reason:
        status === 'successful'
          ? PaymentMessages.TRANSACTION_SUCCESSFUL
          : PaymentMessages.TRANSACTION_PENDING,
      status_code: statusCode,
      accounts: responseAccounts,
    };

    appLogger.info({ response }, 'parse-instruction-complete');
  } catch (error) {
    appLogger.errorX(error, 'parse-instruction-error');
    throw error;
  }

  return response;
}
module.exports = parseInstruction;
