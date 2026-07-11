import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import Sidebar from "./Sidebar";
import Settings from "./Settings";
import AtmMascot from "./AtmMascot";
import Sessions from "../../screens/Sessions/Sessions";
import Memory from "../../screens/Memory/Memory";
import Soul from "../../screens/Soul/Soul";
import Skills from "../../screens/Skills/Skills";
import Tools from "../../screens/Tools/Tools";
import Gateway from "../../screens/Gateway/Gateway";
import Models from "../../screens/Models/Models";
import Schedules from "../../screens/Schedules/Schedules";
import Kanban from "../../screens/Kanban/Kanban";
import CommandPalette from "./CommandPalette";
import AgentPreviewDock from "./AgentPreviewDock";
import ConversationWorkspace from "./ConversationWorkspace";
import { useConversationTabs } from "./conversations";
import { useAgentPreviewDock } from "./useAgentPreviewDock";

type View =
  | "chat"
  | "sessions"
  | "memory"
  | "soul"
  | "skills"
  | "tools"
  | "gateway"
  | "settings"
  | "models"
  | "schedules"
  | "kanban";

type AvatarIntroPhase = "landing" | "waiting" | "flying" | "done";

interface Layout80mProps {
  playSplashLanding?: boolean;
}

const Layout80m: React.FC<Layout80mProps> = ({ playSplashLanding = false }) => {
  const [activeView, setActiveView] = useState<View>("chat");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [avatarIntroPhase, setAvatarIntroPhase] = useState<AvatarIntroPhase>(
    () => (playSplashLanding ? "landing" : "done"),
  );
  const [brainPortalActive, setBrainPortalActive] = useState(false);
  const avatarIntroMascotRef = useRef<HTMLDivElement | null>(null);
  const avatarIntroTimersRef = useRef<number[]>([]);
  const avatarIntroPhaseRef = useRef<AvatarIntroPhase>(avatarIntroPhase);
  const brainPortalTimersRef = useRef<number[]>([]);
  const brainPortalActiveRef = useRef(false);
  const [activeChatRuns, setActiveChatRuns] = useState(0);
  const [runningConversationIds, setRunningConversationIds] = useState<
    Set<string>
  >(new Set());
  const {
    handlePreviewResizeStart,
    previewWidth,
    setShowPreview,
    showPreview,
  } = useAgentPreviewDock();
  const {
    activeConversationId,
    closeConversation,
    conversationViewMode,
    conversations,
    currentSession,
    openConversation,
    selectedAgent,
    setActiveConversationId,
    setActiveConversationProfile,
    setConversationViewMode,
    updateConversationSession,
  } = useConversationTabs();

  // Projects state
  const [activeProject, setActiveProject] = useState<string | null>(() => {
    return localStorage.getItem("hermes-active-project") || null;
  });
  const [showProjectsSidebar, setShowProjectsSidebar] = useState(false);

  const handleProjectChange = useCallback((path: string | null) => {
    setActiveProject(path);
    if (path) {
      localStorage.setItem("hermes-active-project", path);
      setShowProjectsSidebar(true);
    } else {
      localStorage.removeItem("hermes-active-project");
      setShowProjectsSidebar(false);
    }
  }, []);

  const handleSelectProjectFolder = useCallback(async () => {
    if (!window.hermesAPI) return;
    const path = await window.hermesAPI.selectProjectDirectory();
    if (path) {
      handleProjectChange(path);
    }
  }, [handleProjectChange]);

  const handleProjectToolbarToggle = useCallback(() => {
    if (!activeProject) {
      void handleSelectProjectFolder();
      return;
    }
    if (showProjectsSidebar) {
      handleProjectChange(null);
      return;
    }
    setShowProjectsSidebar(true);
  }, [
    activeProject,
    handleProjectChange,
    handleSelectProjectFolder,
    showProjectsSidebar,
  ]);

  const handleFileClick = useCallback((path: string) => {
    // Inject file focus command via a custom event that InputBar / ChatArea can listen to
    const ev = new CustomEvent("inject-chat", {
      detail: `[System: User opened file ${path}]`,
    });
    window.dispatchEvent(ev);
  }, []);

  useEffect(() => {
    avatarIntroPhaseRef.current = avatarIntroPhase;
  }, [avatarIntroPhase]);

  const clearAvatarIntroTimers = useCallback(() => {
    avatarIntroTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    avatarIntroTimersRef.current = [];
  }, []);

  const clearBrainPortalTimers = useCallback(() => {
    brainPortalTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    brainPortalTimersRef.current = [];
  }, []);

  const finishAvatarIntro = useCallback(() => {
    clearAvatarIntroTimers();
    setAvatarIntroPhase("done");
  }, [clearAvatarIntroTimers]);

  const triggerAvatarFlyHome = useCallback(() => {
    if (avatarIntroPhaseRef.current === "flying") return;
    if (avatarIntroPhaseRef.current === "done") return;

    const mascot = avatarIntroMascotRef.current;
    const target = document.querySelector(".sidebar-80m-mascot-picker");

    if (mascot && target instanceof HTMLElement) {
      const mascotRect = mascot.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const flyX =
        targetRect.left +
        targetRect.width / 2 -
        (mascotRect.left + mascotRect.width / 2);
      const flyY =
        targetRect.top +
        targetRect.height / 2 -
        (mascotRect.top + mascotRect.height / 2);

      mascot.style.setProperty("--avatar-fly-x", `${flyX}px`);
      mascot.style.setProperty("--avatar-fly-y", `${flyY}px`);
    }

    clearAvatarIntroTimers();
    setAvatarIntroPhase("flying");
    avatarIntroTimersRef.current = [window.setTimeout(finishAvatarIntro, 940)];
  }, [clearAvatarIntroTimers, finishAvatarIntro]);

  useEffect(() => {
    if (avatarIntroPhase !== "landing") return;

    const settleTimer = window.setTimeout(() => {
      setAvatarIntroPhase("waiting");
    }, 1040);

    avatarIntroTimersRef.current = [
      ...avatarIntroTimersRef.current,
      settleTimer,
    ];
    return () => window.clearTimeout(settleTimer);
  }, [avatarIntroPhase]);

  useEffect(() => {
    if (avatarIntroPhase !== "waiting") return;

    const handlePointerDown = () => triggerAvatarFlyHome();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        triggerAvatarFlyHome();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [avatarIntroPhase, triggerAvatarFlyHome]);

  const openSecondBrain = useCallback(() => {
    if (brainPortalActiveRef.current) return;

    clearBrainPortalTimers();
    brainPortalActiveRef.current = true;
    setBrainPortalActive(true);
    setActiveView("memory");

    brainPortalTimersRef.current = [
      window.setTimeout(() => {
        brainPortalActiveRef.current = false;
        setBrainPortalActive(false);
      }, 800),
    ];
  }, [clearBrainPortalTimers]);

  useEffect(
    () => () => {
      clearAvatarIntroTimers();
      clearBrainPortalTimers();
    },
    [clearAvatarIntroTimers, clearBrainPortalTimers],
  );

  const handleNewSession = useCallback(() => {
    // Hermes owns session ids. First send creates a real Hermes session and
    // ChatArea reports it back to the owning conversation tab.
    openConversation(null, selectedAgent);
    setActiveView("chat");
  }, [openConversation, selectedAgent]);

  const handleSelectSession = useCallback(
    (id: string | null) => {
      if (id === null) {
        // New chat requested via sidebar
        handleNewSession();
        return;
      }
      openConversation(id, selectedAgent);
      setActiveView("chat");
    },
    [handleNewSession, openConversation, selectedAgent],
  );

  const handleCloseConversation = useCallback(
    (id: string) => {
      closeConversation(id, runningConversationIds);
    },
    [closeConversation, runningConversationIds],
  );

  const handleBackToChat = useCallback(() => {
    setActiveView("chat");
  }, []);

  const handleViewChange = useCallback(
    (v: string) => {
      if (v === "memory") {
        openSecondBrain();
        return;
      }

      if (brainPortalActiveRef.current) {
        clearBrainPortalTimers();
        brainPortalActiveRef.current = false;
        setBrainPortalActive(false);
      }

      setActiveView(v as View);
    },
    [clearBrainPortalTimers, openSecondBrain],
  );

  // Ctrl+K / Cmd+K to open command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Listen for custom slash command events from InputBar
  useEffect(() => {
    const handleLayoutCmd = ((e: CustomEvent<string>) => {
      const cmd = e.detail;
      if (cmd === "new" || cmd === "clear") {
        handleNewSession();
      } else if (cmd === "settings") {
        setActiveView("settings");
      }
    }) as EventListener;
    window.addEventListener("layout-cmd", handleLayoutCmd);
    return () => window.removeEventListener("layout-cmd", handleLayoutCmd);
  }, [handleNewSession]);

  useEffect(() => {
    const handleChatStarted = (event: Event) => {
      const detail = (
        event as CustomEvent<{ conversationId?: string; requestId?: string }>
      ).detail;
      setActiveChatRuns((count) => count + 1);
      if (detail?.conversationId) {
        setRunningConversationIds((current) => {
          const next = new Set(current);
          next.add(detail.conversationId!);
          return next;
        });
      }
    };
    const handleChatFinished = (event: Event) => {
      const detail = (
        event as CustomEvent<{ conversationId?: string; requestId?: string }>
      ).detail;
      setActiveChatRuns((count) => {
        const next = Math.max(0, count - 1);
        if (next === 0 && activeProject) {
          setShowPreview(true);
        }
        return next;
      });
      if (detail?.conversationId) {
        setRunningConversationIds((current) => {
          const next = new Set(current);
          next.delete(detail.conversationId!);
          return next;
        });
      }
    };

    window.addEventListener("chat-started", handleChatStarted);
    window.addEventListener("chat-finished", handleChatFinished);
    return () => {
      window.removeEventListener("chat-started", handleChatStarted);
      window.removeEventListener("chat-finished", handleChatFinished);
    };
  }, [activeProject, setShowPreview]);

  const renderMainContent = () => {
    const wrap = (_title: string, el: ReactNode) => (
      <div className="main-80m">
        <div className="screen-content-80m">{el}</div>
      </div>
    );

    const chatShell = (
      <ConversationWorkspace
        activeConversationId={activeConversationId}
        activeProject={activeProject}
        activeViewIsChat={activeView === "chat"}
        conversationViewMode={conversationViewMode}
        conversations={conversations}
        runningConversationIds={runningConversationIds}
        showProjectsSidebar={showProjectsSidebar}
        showPreview={showPreview}
        onActiveConversationChange={(id) => {
          setActiveConversationId(id);
          setActiveView("chat");
        }}
        onCloseConversation={handleCloseConversation}
        onConversationSessionChange={updateConversationSession}
        onConversationViewModeChange={setConversationViewMode}
        onFileClick={handleFileClick}
        onNewSession={handleNewSession}
        onOpenSecondBrain={openSecondBrain}
        onPreviewToggle={() => setShowPreview((open) => !open)}
        onProjectChange={handleProjectChange}
        onProjectToolbarToggle={handleProjectToolbarToggle}
      />
    );

    let activePanel: ReactNode = null;
    switch (activeView) {
      case "chat":
        break;
      case "sessions":
        activePanel = (
          <Sessions
            onResumeSession={(id) => openConversation(id, selectedAgent)}
            onNewChat={handleNewSession}
            currentSessionId={currentSession}
            profile={selectedAgent}
          />
        );
        break;
      case "memory":
        activePanel = (
          <Memory
            profile={selectedAgent !== "default" ? selectedAgent : undefined}
          />
        );
        break;
      case "soul":
        activePanel = wrap(
          "SOUL",
          <Soul
            profile={selectedAgent !== "default" ? selectedAgent : undefined}
          />,
        );
        break;
      case "skills":
        activePanel = wrap(
          "SKILLS",
          <Skills
            profile={selectedAgent !== "default" ? selectedAgent : undefined}
          />,
        );
        break;
      case "tools":
        activePanel = wrap(
          "TOOLS",
          <Tools
            profile={selectedAgent !== "default" ? selectedAgent : undefined}
          />,
        );
        break;
      case "gateway":
        activePanel = wrap("GATEWAY", <Gateway />);
        break;
      case "settings":
        activePanel = (
          <Settings
            onBack={handleBackToChat}
            profile={selectedAgent !== "default" ? selectedAgent : undefined}
          />
        );
        break;
      case "models":
        activePanel = wrap("MODELS", <Models />);
        break;
      case "schedules":
        activePanel = wrap(
          "SCHEDULES",
          <Schedules
            profile={selectedAgent !== "default" ? selectedAgent : undefined}
          />,
        );
        break;
      case "kanban":
        activePanel = wrap("KANBAN", <Kanban />);
        break;
      default:
        break;
    }

    return (
      <div
        style={{ display: "flex", flex: 1, overflow: "hidden", minWidth: 0 }}
      >
        {chatShell}
        {activePanel}
      </div>
    );
  };

  const handleAgentChange = useCallback(
    (agent: string) => {
      setActiveConversationProfile(agent);
      void window.hermesAPI?.setActiveProfile?.(agent);
    },
    [setActiveConversationProfile],
  );

  const agentThemeClass =
    selectedAgent && selectedAgent !== "default"
      ? `theme-${selectedAgent.toLowerCase().replace(/\s+/g, "-")}`
      : "";
  const layoutClasses = [
    "layout-80m",
    agentThemeClass,
    avatarIntroPhase !== "done" ? `avatar-intro-${avatarIntroPhase}` : "",
    brainPortalActive ? "brain-portal-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={layoutClasses}>
      <Sidebar
        activeView={activeView}
        onViewChange={handleViewChange}
        currentSession={currentSession}
        onSelectSession={handleSelectSession}
        selectedAgent={selectedAgent}
        onAgentChange={handleAgentChange}
      />
      <div className={`layout-80m-body${showPreview ? " preview-open" : ""}`}>
        <div className="layout-80m-primary">{renderMainContent()}</div>
        {showPreview && (
          <AgentPreviewDock
            activeProject={activeProject}
            isAgentWorking={activeChatRuns > 0}
            onClose={() => setShowPreview(false)}
            onResizeStart={handlePreviewResizeStart}
            width={previewWidth}
          />
        )}
      </div>

      {avatarIntroPhase !== "done" && (
        <div
          className={`avatar-landing-overlay ${avatarIntroPhase}`}
          aria-hidden="true"
        >
          <div className="avatar-landing-track">
            <div ref={avatarIntroMascotRef} className="avatar-landing-mascot">
              <AtmMascot
                state={avatarIntroPhase === "flying" ? "processing" : "jackpot"}
              />
              <span className="avatar-landing-shadow" />
            </div>
          </div>
        </div>
      )}

      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onNavigate={(view) => {
          handleViewChange(view as View);
          setShowCommandPalette(false);
        }}
        onNewChat={() => {
          handleNewSession();
          setShowCommandPalette(false);
        }}
      />

      {/* Expose toggle for Ctrl+K via a custom event */}
      <div
        id="layout80m-cmd-toggle"
        style={{ display: "none" }}
        onClick={() => setShowCommandPalette((p) => !p)}
      />
    </div>
  );
};

export default Layout80m;
