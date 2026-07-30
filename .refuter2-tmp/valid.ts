import { loadValidatedLedger } from '../scripts/evaluation/behaviorIo';
const l = loadValidatedLedger('artifacts/ledgers/ledger-F-v1.0.0-seed1006.json');
console.log('validated OK:', l.ledgerPath, l.file.scenario.id, l.file.events.length, 'events');
