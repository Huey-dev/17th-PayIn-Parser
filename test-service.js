const parseInstruction = require('./services/payment-processor/parse-instruction');

const testData = {
  accounts: [
    { id: 'acc1', balance: 1000, currency: 'USD' },
    { id: 'acc2', balance: 500, currency: 'USD' },
  ],
  instruction: 'DEBIT 50 USD FROM ACCOUNT acc1 TO ACCOUNT acc2 EXECUTE IMMEDIATELY',
};
parseInstruction(testData)
  .then((result) => console.log('result:', JSON.stringify(result, null, 2)))
  .catch((error) => console.error('error:', error));
