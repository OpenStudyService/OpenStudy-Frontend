// Reuse the cancellation, authorization context, idempotency and synchronous lock
// already exercised by facility/inquiry/notice writes. Pass the detail query key
// to run() so a returned version wins over an older in-flight detail request.
export {
  useRecordWrite as useRoomWrite,
  useRecordLeaveGuard as useRoomLeaveGuard,
} from "../collaboration/hooks";
