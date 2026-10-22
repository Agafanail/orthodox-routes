import { Agent, request, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import webPush from 'web-push';
import { publicPushLookup, pushEndpoint, type PushLookup } from './push-endpoint';

type PushRequest = (
  url: URL, options: RequestOptions, response: (message: IncomingMessage) => void,
) => ClientRequest;

/** Keep the maintained encryption/VAPID implementation, but bound its network effects. */
export function createBoundedWebPushSender(
  resolve?: PushLookup,
  connect: PushRequest = request,
): typeof webPush.sendNotification {
  return async (subscription, payload, options) => {
    const endpoint = pushEndpoint(subscription.endpoint);
    const details = webPush.generateRequestDetails({ ...subscription, endpoint: endpoint.href }, payload ?? undefined, {
      TTL: options?.TTL,
      urgency: options?.urgency,
      vapidDetails: options?.vapidDetails,
    });
    const controller = new AbortController();
    const agent = new Agent({ keepAlive: false, lookup: publicPushLookup(controller.signal, resolve) });
    return new Promise((accept, reject) => {
      let outgoing: ClientRequest | undefined;
      let incoming: IncomingMessage | undefined;
      let completed = false;
      const finish = (status?: number) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        controller.abort();
        incoming?.destroy();
        outgoing?.destroy();
        agent.destroy();
        if (status && status >= 200 && status <= 299) {
          accept({ statusCode: status, headers: {}, body: '' });
        } else {
          const error = new Error('Push provider unavailable');
          reject(status ? Object.assign(error, { statusCode: status }) : error);
        }
      };
      // This is a wall-clock deadline, not a socket-inactivity timeout.
      const timer = setTimeout(() => finish(), 10_000);
      try {
        outgoing = connect(endpoint, {
          agent, method: details.method, headers: details.headers,
          maxHeaderSize: 16_384, signal: controller.signal,
        }, (response) => {
          incoming = response;
          response.on('error', () => finish());
          if (completed) { response.destroy(); return; }
          // Provider acceptance is a status, not proof of handset delivery.
          // Never collect an untrusted response body or follow redirects.
          finish(response.statusCode);
        });
        outgoing.on('error', () => finish());
        outgoing.end(details.body ?? undefined);
      } catch { finish(); }
    });
  };
}

export const sendBoundedWebPush = createBoundedWebPushSender();
