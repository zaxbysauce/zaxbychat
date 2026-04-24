import { useCallback } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { replaceSpecialVars } from 'librechat-data-provider';
import { useToastContext } from '@librechat/client';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import useCapabilityResolution from '~/hooks/Capabilities/useCapabilityResolution';
import useCouncilState from '~/hooks/Council/useCouncilState';
import { useAuthContext } from '~/hooks/AuthContext';
import useLocalize from '~/hooks/useLocalize';
import { mainTextareaId } from '~/common';
import store from '~/store';

export default function useSubmitMessage() {
  const { user } = useAuthContext();
  const methods = useChatFormContext();
  const { conversation: addedConvo } = useAddedChatContext();
  const { ask, index, files, conversation, getMessages, setMessages } = useChatContext();
  const latestMessage = useRecoilValue(store.latestMessageFamily(index));
  const { showToast } = useToastContext();
  const localize = useLocalize();

  const provider = conversation?.endpointType ?? conversation?.endpoint ?? undefined;
  const model = conversation?.model ?? undefined;
  const capabilityResolution = useCapabilityResolution(provider, model);

  const councilState = useCouncilState();

  const autoSendPrompts = useRecoilValue(store.autoSendPrompts);
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(index));

  const submitMessage = useCallback(
    (data?: { text: string }) => {
      if (!data) {
        return console.warn('No data provided to submitMessage');
      }

      const hasImageAttachment = Array.from(files?.values() ?? []).some(
        (f) => typeof f.type === 'string' && f.type.startsWith('image'),
      );
      if (
        hasImageAttachment &&
        capabilityResolution.source === 'explicit' &&
        capabilityResolution.capabilities.vision === false
      ) {
        const displayModel = model ?? provider ?? '';
        showToast({
          message: localize('com_ui_capability_vision_blocked', { 0: displayModel }),
          status: 'error',
        });
        return;
      }

      const rootMessages = getMessages();
      const isLatestInRootMessages = rootMessages?.some(
        (message) => message.messageId === latestMessage?.messageId,
      );
      if (!isLatestInRootMessages && latestMessage) {
        setMessages([...(rootMessages || []), latestMessage]);
      }

      const councilExtras =
        provider && model
          ? councilState.getOutboundExtras({
              endpoint: provider,
              model,
              agent_id: (conversation?.agent_id as string | null | undefined) ?? null,
            })
          : null;

      ask(
        {
          text: data.text,
        },
        {
          addedConvo: addedConvo ?? undefined,
          ...(councilExtras
            ? { councilAgents: councilExtras, councilStrategy: councilState.state.strategy }
            : {}),
        },
      );
      methods.reset();
    },
    [
      ask,
      methods,
      addedConvo,
      setMessages,
      getMessages,
      latestMessage,
      files,
      capabilityResolution,
      model,
      provider,
      showToast,
      localize,
      councilState,
      conversation?.agent_id,
    ],
  );

  const submitPrompt = useCallback(
    (text: string) => {
      const parsedText = replaceSpecialVars({ text, user });
      if (autoSendPrompts) {
        submitMessage({ text: parsedText });
        return;
      }

      const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
      const currentText = textarea?.value ?? methods.getValues('text');
      const newText = currentText.trim().length > 1 ? `\n${parsedText}` : parsedText;
      setActivePrompt(newText);
    },
    [autoSendPrompts, submitMessage, setActivePrompt, methods, user],
  );

  return { submitMessage, submitPrompt };
}
