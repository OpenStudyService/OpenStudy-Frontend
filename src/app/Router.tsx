import {
  createBrowserRouter,
  Link,
  Navigate,
  useRouteError,
} from "react-router";
import { UnsavedChangesBoundary } from "../shared/ui/leaveGuard";
import { PasswordReset } from "../features/auth/PasswordReset";
import { Layout } from "./Layout";
import { Home } from "../features/home/Home";
import {
  Login,
  InvitationAccept,
  PendingApproval,
} from "../features/auth/Login";
import { ResourceGroup, ResourcePage } from "../features/records/ResourcePage";
import { ErrorState, State } from "../shared/ui/primitives";
import { EmployeeManagement } from "../features/organization/Organization";
import { ProductManagement } from "../features/products/Products";
function RouteError() {
  const error = useRouteError();
  return (
    <div className="page">
      <ErrorState
        error={
          error instanceof Error
            ? error
            : new Error("화면을 불러오지 못했습니다.")
        }
      />
      <Link className="btn" to="/login">
        로그인으로 이동
      </Link>
    </div>
  );
}
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/login" replace />,
    errorElement: <RouteError />,
  },
  { path: "/login", element: <Login />, errorElement: <RouteError /> },
  {
    path: "/invitations/accept",
    element: <InvitationAccept />,
    errorElement: <RouteError />,
  },
  {
    path: "/password-reset",
    element: <PasswordReset />,
    errorElement: <RouteError />,
  },
  {
    path: "/pending-approval",
    element: <PendingApproval />,
    errorElement: <RouteError />,
  },
  {
    path: "/app/:scope",
    element: (
      <UnsavedChangesBoundary>
        <Layout />
      </UnsavedChangesBoundary>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="home" replace /> },
      { path: "home", element: <Home /> },
      { path: "tasks", element: <ResourcePage resource="tasks" /> },
      { path: "ai", element: <Navigate to="../chat" replace /> },
      { path: "chat/:channelId", element: <Navigate to="../chat" replace /> },
      {
        path: "members",
        element: (
          <ResourceGroup
            title="회원 관리"
            description="회원의 이용 상황과 응대 이력을 함께 확인해요."
            tabs={[
              { resource: "members", label: "회원 목록" },
              { resource: "passes", label: "보유 이용권" },
            ]}
          />
        ),
      },
      { path: "products", element: <ProductManagement /> },
      { path: "payments", element: <ResourcePage resource="payments" /> },
      {
        path: "reservations",
        element: <ResourcePage resource="reservations" />,
      },
      {
        path: "spaces",
        element: (
          <ResourceGroup
            title="공간 관리"
            description="현장 좌석 배정과 이용 이력, 사물함을 관리해요."
            tabs={[
              { resource: "seats", label: "좌석 현황" },
              { resource: "usage", label: "입퇴실 이력" },
              { resource: "lockers", label: "사물함" },
              { resource: "rooms", label: "스터디룸" },
            ]}
          />
        ),
      },
      { path: "facilities", element: <ResourcePage resource="facilities" /> },
      { path: "inquiries", element: <ResourcePage resource="inquiries" /> },
      { path: "notices", element: <ResourcePage resource="notices" /> },
      {
        path: "attendance",
        lazy: async () => ({
          Component: (await import("../features/attendance/Attendance"))
            .Attendance,
        }),
      },
      {
        path: "employees",
        element: <EmployeeManagement />,
      },
      {
        path: "sales",
        lazy: async () => ({
          Component: (await import("../features/analysis/Sales")).Sales,
        }),
      },
      {
        path: "chat",
        lazy: async () => ({
          Component: (await import("../features/analysis/Ai")).Ai,
        }),
      },
      {
        path: "settings",
        lazy: async () => ({
          Component: (await import("../features/settings/Settings")).Settings,
        }),
      },
      {
        path: "*",
        element: (
          <State
            title="이 화면을 찾을 수 없어요"
            action={
              <Link className="btn" to="home">
                홈으로
              </Link>
            }
          />
        ),
      },
    ],
  },
  {
    path: "*",
    element: (
      <State
        title="이 주소를 찾을 수 없어요"
        action={
          <Link className="btn" to="/login">
            로그인으로
          </Link>
        }
      />
    ),
  },
]);
