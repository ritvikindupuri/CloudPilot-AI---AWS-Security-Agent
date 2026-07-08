import { Trash2, MessageSquare, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/hooks/useChatHistory";
import { formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns";

interface ChatHistoryPanelProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

const groupByDate = (conversations: Conversation[]) => {
  const groups: { label: string; items: Conversation[] }[] = [];
  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const thisWeek: Conversation[] = [];
  const older: Conversation[] = [];

  conversations.forEach((c) => {
    if (!c.updated_at) {
      older.push(c);
      return;
    }
    try {
      const date = parseISO(c.updated_at);
      if (isNaN(date.getTime())) {
        older.push(c);
        return;
      }
      if (isToday(date)) today.push(c);
      else if (isYesterday(date)) yesterday.push(c);
      else if (Date.now() - date.getTime() < 7 * 24 * 60 * 60 * 1000) thisWeek.push(c);
      else older.push(c);
    } catch (e) {
      console.warn("Failed to parse conversation timestamp:", c.updated_at, e);
      older.push(c);
    }
  });

  if (today.length) groups.push({ label: "Today", items: today });
  if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
  if (thisWeek.length) groups.push({ label: "This Week", items: thisWeek });
  if (older.length) groups.push({ label: "Older", items: older });

  return groups;
};

const ChatHistoryPanel = ({
  conversations,
  currentConversationId,
  loading,
  onSelect,
  onDelete,
  onClearAll,
}: ChatHistoryPanelProps) => {
  const groups = groupByDate(conversations);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <MessageSquare className="w-6 h-6 text-muted-foreground/40" />
        <p className="text-[11px] text-muted-foreground">No conversations yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-[9px] font-mono text-muted-foreground/60 tracking-widest uppercase px-1 mb-1">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((conv) => {
              const isActive = conv.id === currentConversationId;
              return (
                <li
                  key={conv.id}
                  className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer transition-colors ${
                    isActive
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted/60 border border-transparent"
                  }`}
                  onClick={() => onSelect(conv.id)}
                >
                  <MessageSquare
                    className={`w-3 h-3 flex-shrink-0 ${
                      isActive ? "text-primary" : "text-muted-foreground/50"
                    }`}
                  />
                  <span
                    className={`flex-1 text-[11px] truncate min-w-0 ${
                      isActive ? "text-foreground font-medium" : "text-muted-foreground"
                    }`}
                    title={conv.title}
                  >
                    {conv.title}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 flex-shrink-0 text-muted-foreground/50 hover:text-destructive transition-all p-0.5 rounded"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {conversations.length > 0 && (
        <div className="pt-1 border-t border-border">
          <button
            onClick={onClearAll}
            className="w-full text-[10px] text-muted-foreground/50 hover:text-destructive transition-colors py-1.5 flex items-center justify-center gap-1.5 font-mono"
          >
            <Trash2 className="w-3 h-3" />
            Clear all history
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatHistoryPanel;
