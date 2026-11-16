import { WeekTimeGrid } from "../../shared/ui/WeekTimeGrid";
import type { RoomReservation } from "./model";

type Booking = { reservation: RoomReservation; branchName: string };

export function WeekCalendar({
  week,
  today,
  bookings,
  calendars,
  showBranch,
  show,
}: {
  week: string;
  today: string;
  bookings: Booking[];
  calendars: { branchName: string; closedDates: string[] }[];
  showBranch: boolean;
  show: (id: string) => void;
}) {
  const closedBranches = (date: string) =>
    calendars
      .filter((calendar) => calendar.closedDates.includes(date))
      .map((calendar) => calendar.branchName);

  return (
    <WeekTimeGrid
      week={week}
      today={today}
      label="주간 예약 시간표"
      emptyMessage="이 주에 표시할 예약이 없어요."
      events={bookings.map(({ reservation, branchName }) => ({
        id: reservation.id,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        title: reservation.room.name,
        label: `${showBranch ? `${branchName} · ` : ""}${reservation.room.name} · ${reservation.customer.name} · ${reservation.status}`,
        detail: `${reservation.status} · ${showBranch ? branchName : reservation.customer.name}`,
        status: reservation.status,
        onSelect: () => show(reservation.id),
      }))}
      getDayNotes={(date) => {
        const closed = closedBranches(date);
        return closed.length
          ? [showBranch ? `${closed.join(", ")} 휴무` : "지점 휴무"]
          : [];
      }}
      isDayClosed={(date) => !showBranch && closedBranches(date).length > 0}
    />
  );
}
