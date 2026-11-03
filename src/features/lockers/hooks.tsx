// Shared writes cancel on context/permission changes, retain logical idempotency
// keys and synchronously lock submits. Detail keys prevent stale GET overwrites.
export {
  useRecordWrite as useLockerWrite,
  useRecordLeaveGuard as useLockerLeaveGuard,
} from "../collaboration/hooks";
