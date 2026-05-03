"use client";

import {
  activeTicketsResponseSchema,
  authErrorSchema,
  checkInResponseSchema,
  currentUserSchema,
  otpRequestInputSchema,
  otpVerifyInputSchema,
  patientQueuesResponseSchema,
  patientSitesResponseSchema,
  type CurrentUser,
  type PatientQueueSummary,
  type PatientSiteSummary,
  type PatientTicketSummary,
} from "@qdoc/contracts";
import { Bell, Check, ClipboardList, Clock3, Loader2, LogOut, Mail, MapPin, RefreshCcw, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

type RequestState = "idle" | "loading" | "success" | "error";
type AuthStep = "email" | "code";

type ApiError = {
  status: number;
  error: string;
};

const ticketStatusLabels: Record<PatientTicketSummary["status"], string> = {
  waiting: "Waiting",
  called: "Called",
  in_service: "In service",
  completed: "Completed",
  delay: "Delayed",
  cancelled: "Cancelled",
};

const ticketStatusStyles: Record<PatientTicketSummary["status"], string> = {
  waiting: "bg-amber-50 text-amber-800 ring-amber-200",
  called: "bg-sky-50 text-sky-800 ring-sky-200",
  in_service: "bg-violet-50 text-violet-800 ring-violet-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  delay: "bg-orange-50 text-orange-800 ring-orange-200",
  cancelled: "bg-slate-100 text-slate-700 ring-slate-200",
};

const patientReadyMessage = "Your turn is coming up. Please stay nearby.";

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
    return "Sign in to continue.";
  }

  if (error.error === "conflict") {
    return "You already have an active ticket at this site.";
  }

  if (error.error === "queue_closed") {
    return "This queue is currently closed.";
  }

  return "Request failed. Try again.";
}

export default function Home() {
  const [sites, setSites] = useState<PatientSiteSummary[]>([]);
  const [queues, setQueues] = useState<PatientQueueSummary[]>([]);
  const [tickets, setTickets] = useState<PatientTicketSummary[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [selectedQueueId, setSelectedQueueId] = useState<string>("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [sitesState, setSitesState] = useState<RequestState>("loading");
  const [queuesState, setQueuesState] = useState<RequestState>("idle");
  const [ticketState, setTicketState] = useState<RequestState>("idle");
  const [authState, setAuthState] = useState<RequestState>("idle");
  const [checkInState, setCheckInState] = useState<RequestState>("idle");
  const [message, setMessage] = useState("");

  const selectedSite = useMemo(() => {
    return sites.find((site) => site.id === selectedSiteId) ?? null;
  }, [selectedSiteId, sites]);

  const activeSiteTicket = useMemo(() => {
    return tickets.find((ticket) => ticket.siteId === selectedSiteId) ?? null;
  }, [selectedSiteId, tickets]);

  const latestReadyNotification = useMemo(() => {
    return (
      tickets
        .flatMap((ticket) =>
          ticket.notifications
            .filter((notification) => notification.message === patientReadyMessage)
            .map((notification) => ({
              ...notification,
              siteName: ticket.siteName,
              queueName: ticket.queueName,
            })),
        )
        .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))[0] ?? null
    );
  }, [tickets]);

  const clearPatientSession = useCallback(() => {
    setCurrentUser(null);
    setTickets([]);
    setTicketState("idle");
  }, []);

  const loadTickets = useCallback(async () => {
    if (!currentUser) {
      return;
    }

    try {
      const response = await fetch("/api/patients/me/tickets/active", { cache: "no-store" });
      const data = await readApiResponse(response, activeTicketsResponseSchema);
      setTickets(data.tickets);
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        clearPatientSession();
      }

      throw error;
    }
  }, [clearPatientSession, currentUser]);

  const loadCurrentUser = useCallback(async () => {
    const response = await fetch("/api/me", { cache: "no-store" });

    if (response.status === 401) {
      clearPatientSession();
      return;
    }

    const user = await readApiResponse(response, currentUserSchema);
    setCurrentUser(user);
  }, [clearPatientSession]);

  useEffect(() => {
    let cancelled = false;

    async function loadSites() {
      setSitesState("loading");

      try {
        const response = await fetch("/api/sites", { cache: "no-store" });
        const data = await readApiResponse(response, patientSitesResponseSchema);

        if (cancelled) {
          return;
        }

        setSites(data.sites);
        setSelectedSiteId((current) => current || data.sites[0]?.id || "");
        setSitesState("success");
      } catch (error) {
        if (!cancelled) {
          setSitesState("error");
          setMessage(getMessage(error));
        }
      }
    }

    void loadSites();
    loadCurrentUser().catch((error: unknown) => {
      if (!cancelled) {
        clearPatientSession();
        setMessage(getMessage(error));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clearPatientSession, loadCurrentUser]);

  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }

    let cancelled = false;

    async function loadQueues() {
      setQueuesState("loading");

      try {
        const response = await fetch(`/api/sites/${selectedSiteId}/queues`, { cache: "no-store" });
        const data = await readApiResponse(response, patientQueuesResponseSchema);

        if (cancelled) {
          return;
        }

        setQueues(data.queues);
        setSelectedQueueId((current) => {
          if (data.queues.some((queue) => queue.id === current)) {
            return current;
          }

          return data.queues[0]?.id || "";
        });
        setQueuesState("success");
      } catch (error) {
        if (!cancelled) {
          setQueuesState("error");
          setMessage(getMessage(error));
        }
      }
    }

    void loadQueues();

    return () => {
      cancelled = true;
    };
  }, [selectedSiteId]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    setTicketState("loading");
    loadTickets()
      .then(() => {
        setTicketState("success");
      })
      .catch((error: unknown) => {
        setTicketState("error");
        setMessage(getMessage(error));
      });
  }, [currentUser, loadTickets]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadTickets().catch((error: unknown) => {
        if (!isApiError(error) || error.status !== 401) {
          setMessage(getMessage(error));
        }
      });
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [currentUser, loadTickets]);

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
      setCurrentUser(user);
      setAuthState("success");
      setMessage("Signed in.");
    } catch (error) {
      setAuthState("error");
      setMessage(getMessage(error));
    }
  }

  async function checkIn() {
    if (!selectedSiteId || !selectedQueueId) {
      return;
    }

    setMessage("");
    setCheckInState("loading");

    try {
      const response = await fetch(`/api/sites/${selectedSiteId}/check-ins`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queueId: selectedQueueId }),
      });

      const data = await readApiResponse(response, checkInResponseSchema);
      setTickets((current) => [data.ticket, ...current.filter((ticket) => ticket.id !== data.ticket.id)]);
      setCheckInState("success");
      setMessage("Check-in complete.");
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        clearPatientSession();
      }

      setCheckInState("error");
      setMessage(getMessage(error));
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearPatientSession();
    setAuthStep("email");
    setCode("");
    setMessage("");
  }

  return (
    <main className="min-h-screen bg-[#f4fbfb] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex flex-col gap-5">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-[#10b9c4] text-white">
                <Stethoscope size={22} aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium uppercase text-slate-500">QDoc</p>
                <h1 className="text-2xl font-semibold text-slate-950 sm:text-3xl">Clinic queue</h1>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void loadTickets();
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[#b9eaee] bg-white px-3 text-sm font-medium text-[#087884] shadow-sm hover:bg-[#eefbfc] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!currentUser}
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

          {latestReadyNotification ? (
            <div className="flex gap-3 rounded-lg border border-[#b9eaee] bg-[#e9fbfc] px-4 py-3 text-sm text-[#075966] shadow-sm">
              <Bell size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{latestReadyNotification.message}</p>
                <p className="mt-1 text-xs text-[#087884]">
                  {latestReadyNotification.siteName} · {latestReadyNotification.queueName} ·{" "}
                  {new Date(latestReadyNotification.createdAt).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ) : null}

          <section className="grid gap-3 md:grid-cols-2">
            {sitesState === "loading" ? (
              <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
                Loading clinics...
              </div>
            ) : null}
            {sites.map((site) => (
              <button
                key={site.id}
                type="button"
                onClick={() => setSelectedSiteId(site.id)}
                className={`rounded-lg border bg-white p-5 text-left shadow-sm transition hover:border-[#10b9c4] ${
                  selectedSiteId === site.id ? "border-[#10b9c4] ring-2 ring-[#10b9c4]/15" : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{site.name}</h2>
                    <p className="mt-1 text-sm text-slate-600">{site.waitingTicketCount} patients waiting</p>
                  </div>
                  <div className="grid justify-items-center gap-1 text-[#0a8f9c]">
                    <MapPin size={21} aria-hidden="true" />
                    <span className="text-xs font-medium">{site.distanceKm.toFixed(1)} km</span>
                  </div>
                </div>
              </button>
            ))}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <ClipboardList size={21} className="text-[#0a8f9c]" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{selectedSite?.name ?? "Select a clinic"}</h2>
                <p className="text-sm text-slate-600">Choose a queue and check in.</p>
              </div>
            </div>

            <div className="grid gap-3">
              {queuesState === "loading" ? <p className="text-sm text-slate-500">Loading queues...</p> : null}
              {queues.map((queue) => (
                <label
                  key={queue.id}
                  className={`flex cursor-pointer items-center justify-between gap-4 rounded-md border p-4 ${
                    selectedQueueId === queue.id ? "border-[#10b9c4] bg-[#eefbfc]" : "border-slate-200"
                  }`}
                >
                  <span>
                    <span className="block font-medium text-slate-950">{queue.name}</span>
                    <span className="text-sm text-slate-500">{queue.isOpen ? "Open" : "Closed"}</span>
                  </span>
                  <input
                    type="radio"
                    name="queue"
                    value={queue.id}
                    checked={selectedQueueId === queue.id}
                    onChange={() => setSelectedQueueId(queue.id)}
                    className="size-4 accent-[#10b9c4]"
                  />
                </label>
              ))}
            </div>

            {activeSiteTicket ? (
              <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                <div className="flex flex-wrap items-center gap-2">
                  <span>You are checked in for {activeSiteTicket.queueName}.</span>
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ${ticketStatusStyles[activeSiteTicket.status]}`}
                  >
                    {ticketStatusLabels[activeSiteTicket.status]}
                  </span>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void checkIn();
                }}
                disabled={!selectedQueueId || checkInState === "loading"}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#10b9c4] px-4 text-sm font-semibold text-white hover:bg-[#0ea5b2] disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {checkInState === "loading" ? <Loader2 className="animate-spin" size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
                Check in
              </button>
            )}
          </section>
        </section>

        <aside className="flex flex-col gap-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Patient session</h2>
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
                  placeholder="you@example.com"
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
              <Clock3 size={21} className="text-[#0a8f9c]" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Active tickets</h2>
                <p className="text-sm text-slate-600">Updates every 4 seconds.</p>
              </div>
            </div>

            {!currentUser ? <p className="text-sm text-slate-500">Sign in to view active tickets.</p> : null}
            {currentUser && ticketState === "loading" ? <p className="text-sm text-slate-500">Loading tickets...</p> : null}
            {currentUser && tickets.length === 0 && ticketState !== "loading" ? (
              <p className="text-sm text-slate-500">No active tickets.</p>
            ) : null}
            <div className="grid gap-3">
              {tickets.map((ticket) => (
                <article key={ticket.id} className="rounded-md border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-950">{ticket.siteName}</h3>
                      <p className="text-sm text-slate-600">{ticket.queueName}</p>
                    </div>
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ${ticketStatusStyles[ticket.status]}`}>
                      {ticketStatusLabels[ticket.status]}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">Checked in {new Date(ticket.createdAt).toLocaleTimeString()}</p>
                  {ticket.notifications.length > 0 ? (
                    <div className="mt-4 grid gap-2 border-t border-slate-100 pt-3">
                      {ticket.notifications.map((notification) => (
                        <div key={notification.id} className="flex gap-2 text-sm text-slate-700">
                          <Bell size={15} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
                          <div>
                            <p>{notification.message}</p>
                            <p className="mt-1 text-xs text-slate-500">{new Date(notification.createdAt).toLocaleTimeString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
