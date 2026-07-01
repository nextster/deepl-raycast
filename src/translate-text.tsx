import { Action, ActionPanel, Detail, Icon, LaunchProps, LocalStorage } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useEffect, useState } from "react";
import {
  CompletedTranslation,
  TranslationLaunchContext,
  getTranslationStorageKey,
  isCompletedTranslation,
  isTranslationStorageKey,
} from "./translation-payload";

type TranslateTextProps = LaunchProps<{
  arguments: Arguments.TranslateText;
  launchContext?: TranslationLaunchContext;
}>;

type TranslationState =
  | { status: "loading" }
  | {
      status: "success";
      sourceText: string;
      translatedText: string;
      sourceLang?: string;
      targetLang: "EN" | "RU";
      rule: string;
    }
  | { status: "error"; message: string };

function markdownForState(state: TranslationState) {
  if (state.status === "loading") {
    return "Loading translation...";
  }

  if (state.status === "error") {
    return `# Translation failed\n\n${state.message}`;
  }

  return [`# Translation`, state.translatedText, "", "## Source", state.sourceText].join("\n\n");
}

export default function Command(props: TranslateTextProps) {
  const completedTranslation = isCompletedTranslation(props.launchContext) ? props.launchContext : undefined;
  const argumentText = (props.arguments as Partial<Arguments.TranslateText> | undefined)?.text || "";
  const storageKey =
    getTranslationStorageKey(props.launchContext) || (isTranslationStorageKey(argumentText) ? argumentText : undefined);
  const [state, setState] = useState<TranslationState>(
    completedTranslation ? { status: "success", ...completedTranslation } : { status: "loading" },
  );

  useEffect(() => {
    if (completedTranslation) {
      return;
    }

    if (!storageKey) {
      setState({ status: "error", message: "Stored translation was not found" });
      return;
    }

    const translationStorageKey = storageKey;
    async function loadStoredTranslation() {
      try {
        const serializedTranslation = await LocalStorage.getItem<string>(translationStorageKey);
        await LocalStorage.removeItem(translationStorageKey);

        if (!serializedTranslation) {
          throw new Error("Stored translation was not found");
        }

        const storedTranslation = JSON.parse(serializedTranslation) as CompletedTranslation;
        setState({ status: "success", ...storedTranslation });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState({ status: "error", message });
        await showFailureToast(error, { title: "Couldn't open translation" });
      }
    }

    loadStoredTranslation();
  }, []);

  const metadata =
    state.status === "success" ? (
      <Detail.Metadata>
        <Detail.Metadata.Label title="Direction" text={`${state.sourceLang || "AUTO"} -> ${state.targetLang}`} />
        <Detail.Metadata.Label title="Rule" text={state.rule} />
        <Detail.Metadata.Label title="Characters" text={String(state.sourceText.length)} />
      </Detail.Metadata>
    ) : undefined;

  return (
    <Detail
      isLoading={state.status === "loading"}
      markdown={markdownForState(state)}
      metadata={metadata}
      actions={
        <ActionPanel>
          {state.status === "success" ? (
            <>
              <Action.CopyToClipboard title="Copy Translation" icon={Icon.Clipboard} content={state.translatedText} />
              <Action.Paste title="Paste Translation" content={state.translatedText} />
              <Action.CopyToClipboard title="Copy Source" content={state.sourceText} />
            </>
          ) : null}
        </ActionPanel>
      }
    />
  );
}
