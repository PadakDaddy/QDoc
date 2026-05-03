"use client";

import {
  authErrorSchema,
  currentUserSchema,
  otpRequestInputSchema,
  otpVerifyInputSchema,
  staffQueueResponseSchema,
  staffTicketResponseSchema,
  type CurrentUser,
  type StaffQueueResponse,
  type TicketStatus,
} from "@qdoc/contracts";
import {
  Activity,
  Bell,
  Check,
  ClipboardList,
  Loader2,
  LogOut,
  Mail,
  RefreshCcw,
  Stethoscope,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

type RequestState = "idle" | "loading" | "success" | "error";
type AuthStep = "email" | "code";
type StaffTicketAction = "call" | "start-service" | "complete" | "delay" | "restore" | "cancel";
type StaffBoardTicket = StaffQueueResponse["tickets"][number];
type StaffMembership = CurrentUser["memberships"][number];

type ApiError = {
  status: number;
  error: string;
};

const boardStatuses: Array<{ status: TicketStatus; label: string }> = [
  { status: "waiting", label: "Waiting" },
  { status: "called", label: "Called" },
  { status: "in_service", label: "In service" },
  { status: "delay", label: "Delayed" },
];

const ticketStatusLabels: Record<TicketStatus, string> = {
  waiting: "Waiting",
  called: "Called",
  in_service: "In service",
  completed: "Completed",
  delay: "Delayed",
  cancelled: "Cancelled",
};

const ticketStatusStyles: Record<TicketStatus, string> = {
  waiting: "bg-amber-50 text-amber-800 ring-amber-200",
  called: "bg-sky-50 text-sky-800 ring-sky-200",
  in_service: "bg-violet-50 text-violet-800 ring-violet-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  delay: "bg-orange-50 text-orange-800 ring-orange-200",
  cancelled: "bg-slate-100 text-slate-700 ring-slate-200",
};

async function readApiResponse<T>(response: Response, schema: z.ZodSchema<T>) {
  const data: unknown = await response.json();

  if (!response.ok) {
    const parsedError = authErrorSchema.safeParse(data);
    const error = new Error(parsedError.success ? parsedError.data.error : "request_failed") as Error & ApiError;
    error.status = response.status;
    error.error = parsedError.success ? parsedError.data.error : "request_failed";
    throw error;
  }

  return schema.parse(data);
}

function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && "status" in error && "error" in error;
}

function getMessage(error: unknown) {
  if (!isApiError(error)) {
    return "Request failed. Try again.";
  }

  if (error.error === "unauthorized") {
    return "Sign in with a staff account.";
  }

  if (error.error === "forbidden") {
    return "This account does not have access to the selected site.";
  }

  if (error.error === "invalid_transition") {
    return "That ticket can no longer move to the requested status.";
  }

  return "Request failed. Try again.";
}

function getActions(ticket: StaffBoardTicket): Array<{ action: StaffTicketAction; label: string }> {
  if (ticket.status === "waiting") {
    return [
      { action: "call", label: "Call" },
      { action: "cancel", label: "Cancel" },
    ];
  }

  if (ticket.status === "called") {
    return [
      { action: "start-service", label: "Start" },
      { action: "delay", label: "Delay" },
      { action: "cancel", label: "Cancel" },
    ];
  }

  if (ticket.status === "in_service") {
    return [{ action: "complete", label: "Complete" }];
  }

  if (ticket.status === "delay") {
    return [
      { action: "restore", label: "Restore" },
      { action: "cancel", label: "Cancel" },
    ];
  }

  return [];
}

function getMembershipWaitingCount(membership: StaffMembership, activeQueueBoard: StaffQueueResponse | null) {
  if (activeQueueBoard?.siteId !== membership.siteId) {
    return membership.waitingTicketCount;
  }

  return activeQueueBoard.tickets.filter((ticket) => ticket.status === "waiting").length;
}

export default function StaffPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [queueBoard, setQueueBoard] = useState<StaffQueueResponse | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [authState, setAuthState] = useState<RequestState>("idle");
  const [boardState, setBoardState] = useState<RequestState>("idle");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const boardRequestId = useRef(0);

  const staffMemberships = useMemo(() => {
    return currentUser?.memberships.filter((membership) => membership.role === "staff" || membership.role === "admin") ?? [];
  }, [currentUser]);

  const selectedMembership = useMemo(() => {
    return staffMemberships.find((membership) => membership.siteId === selectedSiteId) ?? null;
  }, [selectedSiteId, staffMemberships]);

  const activeQueueBoard = queueBoard?.siteId === selectedSiteId ? queueBoard : null;

  const ticketsByStatus = useMemo(() => {
    return Object.fromEntries(
      boardStatuses.map(({ status }) => [status, activeQueueBoard?.tickets.filter((ticket) => ticket.status === status) ?? []]),
    ) as Record<TicketStatus, StaffBoardTicket[]>;
  }, [activeQueueBoard]);

  const clearStaffSession = useCallback(() => {
    boardRequestId.current += 1;
    setCurrentUser(null);
    setQueueBoard(null);
    setSelectedSiteId("");
    setAuthStep("email");
    setAuthState("idle");
    setCode("");
    setBoardState("idle");
  }, []);

  const loadBoard = useCallback(async () => {
    if (!selectedSiteId || !currentUser) {
      return;
    }

    const requestSiteId = selectedSiteId;
    const requestId = boardRequestId.current + 1;
    boardRequestId.current = requestId;

    try {
      const response = await fetch(`/api/staff/sites/${requestSiteId}/queue`, { cache: "no-store" });
      const data = await readApiResponse(response, staffQueueResponseSchema);

      if (boardRequestId.current !== requestId || data.siteId !== requestSiteId) {
        return false;
      }

      setQueueBoard(data);
      return true;
    } catch (error) {
      if (boardRequestId.current !== requestId) {
        return false;
      }

      if (isApiError(error) && error.status === 401) {
        clearStaffSession();
      } else {
        setQueueBoard(null);
      }

      throw error;
    }
  }, [clearStaffSession, currentUser, selectedSiteId]);

  const loadCurrentUser = useCallback(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });

    if (response.status === 401) {
      clearStaffSession();
      return;
    }

    const user = await readApiResponse(response, currentUserSchema);
    setCurrentUser(user);
    const firstStaffSite = user.memberships.find((membership) => membership.role === "staff" || membership.role === "admin");
    setSelectedSiteId(firstStaffSite?.siteId || "");
  }, [clearStaffSession]);

  useEffect(() => {
    loadCurrentUser().catch((error: unknown) => {
      clearStaffSession();
      setMessage(getMessage(error));
    });
  }, [clearStaffSession, loadCurrentUser]);

  useEffect(() => {
    if (!currentUser || !selectedSiteId) {
      return;
    }

    setQueueBoard(null);
    setBoardState("loading");
    loadBoard()
      .then((applied) => {
        if (applied) {
          setBoardState("success");
        }
      })
      .catch((error: unknown) => {
        setBoardState("error");
        setMessage(getMessage(error));
      });
  }, [currentUser, loadBoard, selectedSiteId]);

  useEffect(() => {
    if (!currentUser || !selectedSiteId) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadBoard().catch((error: unknown) => {
        if (!isApiError(error) || error.status !== 401) {
          setMessage(getMessage(error));
        }
      });
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [currentUser, loadBoard, selectedSiteId]);

  async function requestOtp() {
    setMessage("");
    setAuthState("loading");

    const input = otpRequestInputSchema.safeParse({ email });

    if (!input.success) {
      setAuthState("error");
      setMessage("Enter a valid email address.");
      return;
    }

    try {
      const response = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.data),
      });

      await readApiResponse(response, z.object({ ok: z.literal(true) }));
      setAuthStep("code");
      setAuthState("success");
      setMessage("Enter the verification code sent to your email.");
    } catch (error) {
      setAuthState("error");
      setMessage(getMessage(error));
    }
  }

  async function verifyOtp() {
    setMessage("");
    setAuthState("loading");

    const input = otpVerifyInputSchema.safeParse({ email, code });

    if (!input.success) {
      setAuthState("error");
      setMessage("Enter the 6-digit verification code.");
      return;
    }

    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.data),
      });

      const user = await readApiResponse(response, currentUserSchema);
      const firstStaffSite = user.memberships.find((membership) => membership.role === "staff" || membership.role === "admin");

      setCurrentUser(user);
      setSelectedSiteId(firstStaffSite?.siteId || "");
      setAuthState("success");
      setMessage(firstStaffSite ? "Signed in." : "This account does not have staff access.");
    } catch (error) {
      setAuthState("error");
      setMessage(getMessage(error));
    }
  }

  async function applyAction(ticketId: string, action: StaffTicketAction) {
    const ticket = activeQueueBoard?.tickets.find((item) => item.id === ticketId);

    if (!ticket || ticket.siteId !== selectedSiteId) {
      setMessage("Refresh the board before changing this ticket.");
      return;
    }

    const actionKey = `${ticketId}:${action}`;
    setActiveAction(actionKey);
    setMessage("");

    try {
      const response = await fetch(`/api/staff/tickets/${ticketId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: selectedSiteId }),
      });
      await readApiResponse(response, staffTicketResponseSchema);
      await loadBoard();
    } catch (error) {
      setMessage(getMessage(error));
    } finally {
      setActiveAction(null);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearStaffSession();
    setMessage("");
  }

  return (
    <main className="min-h-screen bg-[#f4fbfb] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[#10b9c4] text-white">
              <Stethoscope size={22} aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium uppercase text-slate-500">QDoc</p>
              <h1 className="text-2xl font-semibold text-slate-950 sm:text-3xl">Staff queue board</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadBoard();
            }}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[#b9eaee] bg-white px-3 text-sm font-medium text-[#087884] shadow-sm hover:bg-[#eefbfc] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!currentUser || !selectedSiteId}
          >
            <RefreshCcw size={16} aria-hidden="true" />
            Refresh
          </button>
        </header>

        {message ? (
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            {message}
          </div>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Staff session</h2>
                  <p className="text-sm text-slate-600">{currentUser ? currentUser.email : "Sign in with email OTP."}</p>
                </div>
                {currentUser ? (
                  <button
                    type="button"
                    onClick={() => {
                      void signOut();
                    }}
                    className="inline-flex size-9 items-center justify-center rounded-md border border-[#b9eaee] text-[#087884] hover:bg-[#eefbfc]"
                    aria-label="Sign out"
                  >
                    <LogOut size={17} aria-hidden="true" />
                  </button>
                ) : (
                  <Mail size={21} className="text-[#0a8f9c]" aria-hidden="true" />
                )}
              </div>

              {!currentUser ? (
                <div className="grid gap-3">
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="staff@example.com"
                    className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#10b9c4]"
                  />
                  {authStep === "code" ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="6-digit code"
                      className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#10b9c4]"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      void (authStep === "email" ? requestOtp() : verifyOtp());
                    }}
                    disabled={authState === "loading"}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#10b9c4] px-4 text-sm font-semibold text-white hover:bg-[#0ea5b2] disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {authState === "loading" ? <Loader2 className="animate-spin" size={17} aria-hidden="true" /> : null}
                    {authStep === "email" ? "Send code" : "Sign in"}
                  </button>
                </div>
              ) : null}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-3">
                <ClipboardList size={21} className="text-[#0a8f9c]" aria-hidden="true" />
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Sites</h2>
                  <p className="text-sm text-slate-600">Choose a staffed location.</p>
                </div>
              </div>
              {staffMemberships.length === 0 ? <p className="text-sm text-slate-500">No staff memberships.</p> : null}
              <div className="grid gap-2">
                {staffMemberships.map((membership) => (
                  <button
                    key={membership.siteId}
                    type="button"
                    onClick={() => {
                      boardRequestId.current += 1;
                      setQueueBoard(null);
                      setBoardState("loading");
                      setSelectedSiteId(membership.siteId);
                    }}
                    className={`rounded-md border px-3 py-3 text-left text-sm font-medium ${
                      selectedSiteId === membership.siteId ? "border-[#10b9c4] bg-[#eefbfc]" : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className="block text-slate-950">{membership.siteName}</span>
                    <span className="text-xs uppercase text-slate-500">
                      {getMembershipWaitingCount(membership, activeQueueBoard)} waiting · {membership.role}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className="flex flex-col gap-4">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">{activeQueueBoard?.siteName ?? selectedMembership?.siteName ?? "Queue board"}</h2>
                  <p className="text-sm text-slate-600">Updates every 4 seconds.</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Activity size={17} aria-hidden="true" />
                  {boardState === "loading" ? "Loading" : `${activeQueueBoard?.tickets.length ?? 0} active tickets`}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-4">
              {boardStatuses.map(({ status, label }) => (
                <section key={status} className="min-h-[320px] rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-950">{label}</h3>
                      <p className="text-sm text-slate-500">{ticketsByStatus[status].length} tickets</p>
                    </div>
                    <Bell size={19} className="text-[#7ccfd6]" aria-hidden="true" />
                  </div>

                  <div className="grid gap-3">
                    {ticketsByStatus[status].length === 0 ? (
                      <p className="rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">No tickets.</p>
                    ) : null}

                    {ticketsByStatus[status].map((ticket) => (
                      <article key={ticket.id} className="min-w-0 rounded-md border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="font-semibold text-slate-950">{ticket.queueName}</h4>
                            <p className="mt-1 break-all text-sm text-slate-600">{ticket.patientEmail}</p>
                            <p className="mt-1 text-xs text-slate-500">Checked in {new Date(ticket.createdAt).toLocaleTimeString()}</p>
                          </div>
                          <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ring-1 ${ticketStatusStyles[ticket.status]}`}>
                            {ticketStatusLabels[ticket.status]}
                          </span>
                        </div>

                        <div className="mt-4 grid min-w-0 gap-2">
                          {getActions(ticket).map(({ action, label: actionLabel }) => {
                            const actionKey = `${ticket.id}:${action}`;
                            const isBusy = activeAction === actionKey;
                            const isCancel = action === "cancel" || action === "delay";

                            return (
                              <button
                                key={action}
                                type="button"
                                onClick={() => {
                                  void applyAction(ticket.id, action);
                                }}
                                disabled={Boolean(activeAction)}
                                className={`inline-flex min-h-9 w-full min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold leading-tight disabled:cursor-not-allowed disabled:opacity-60 ${
                                  isCancel
                                    ? "border border-[#b9eaee] bg-white text-[#087884] hover:bg-[#eefbfc]"
                                    : "bg-[#10b9c4] text-white hover:bg-[#0ea5b2]"
                                }`}
                              >
                                {isBusy ? (
                                  <Loader2 className="animate-spin" size={15} aria-hidden="true" />
                                ) : isCancel ? (
                                  <X size={15} aria-hidden="true" />
                                ) : (
                                  <Check size={15} aria-hidden="true" />
                                )}
                                {actionLabel}
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
