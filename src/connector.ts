import {
  Protoframe,
  ProtoframeMessageType,
  ProtoframeMessageResponse,
  ProtoframeMessageBody,
  ProtoframeDescriptor,
  ProtoframePayloadBody,
  ProtoframePayloadResponse,
  ProtoframeAction,
} from './types';
import { hasValue } from './util';

function mkPayloadType<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  protocol: ProtoframeDescriptor<P>,
  action: ProtoframeAction,
  type: T,
): string {
  return `${protocol.type}#${action}#${type}`;
}

function mkPayloadBody<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  protocol: ProtoframeDescriptor<P>,
  action: ProtoframeAction,
  type: T,
  body: ProtoframeMessageBody<P, T>,
): ProtoframePayloadBody<P, T> {
  return {
    body,
    type: mkPayloadType(protocol, action, type),
  };
}

function mkPayloadResponse<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  protocol: ProtoframeDescriptor<P>,
  type: T,
  response: ProtoframeMessageResponse<P, T>,
): ProtoframePayloadResponse<P, T> {
  return {
    response,
    type: mkPayloadType(protocol, 'ask', type),
  };
}

function isPayloadBodyOfType<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  protocol: ProtoframeDescriptor<P>,
  action: ProtoframeAction,
  type: T,
  payload: { type?: string; body?: unknown } | undefined,
): payload is ProtoframePayloadBody<P, T> {
  if (hasValue(payload)) {
    const payloadType = payload.type;
    if (hasValue(payloadType) && hasValue(payload.body)) {
      const [p, a, t] = payloadType.split('#');
      return p === protocol.type && a === action && t === type;
    } else {
      return false;
    }
  } else {
    return false;
  }
}

function isPayloadResponseOfType<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  protocol: ProtoframeDescriptor<P>,
  type: T,
  payload: { type?: string; response?: unknown } | undefined,
): payload is ProtoframePayloadResponse<P, T> {
  if (hasValue(payload)) {
    const payloadType = payload.type;
    if (hasValue(payloadType) && hasValue(payload.response)) {
      const [p, a, t] = payloadType.split('#');
      return p === protocol.type && a === 'ask' && t === type;
    } else {
      return false;
    }
  } else {
    return false;
  }
}

function awaitResponse<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>
>(
  thisWindow: Window,
  protocol: ProtoframeDescriptor<P>,
  type: T,
): Promise<ProtoframeMessageResponse<P, T>> {
  return new Promise((accept) => {
    const handle: (ev: MessageEvent) => void = (ev) => {
      const payload = ev.data;
      if (isPayloadResponseOfType(protocol, type, payload)) {
        thisWindow.removeEventListener('message', handle);
        accept(payload.response);
      }
    };
    thisWindow.addEventListener('message', handle);
  });
}

function handleTell0<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  _R extends ProtoframeMessageResponse<P, T> & undefined
>(
  thisWindow: Window,
  protocol: ProtoframeDescriptor<P>,
  type: T,
  handler: (body: ProtoframeMessageBody<P, T>) => void,
): void {
  thisWindow.addEventListener('message', (ev) => {
    const payload = ev.data;
    if (isPayloadBodyOfType(protocol, 'tell', type, payload)) {
      handler(payload.body);
    }
  });
}

function handleAsk0<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  _R extends ProtoframeMessageResponse<P, T> & {}
>(
  thisWindow: Window,
  targetWindow: Window,
  protocol: ProtoframeDescriptor<P>,
  type: T,
  targetOrigin: string,
  handler: (
    body: ProtoframeMessageBody<P, T>,
  ) => Promise<ProtoframeMessageResponse<P, T>>,
): void {
  thisWindow.addEventListener('message', async (ev) => {
    const payload = ev.data;
    if (isPayloadBodyOfType(protocol, 'ask', type, payload)) {
      const response = await handler(payload.body);
      targetWindow.postMessage(
        mkPayloadResponse(protocol, type, response),
        targetOrigin,
      );
    }
  });
}

function tell0<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  _R extends ProtoframeMessageResponse<P, T> & undefined
>(
  targetWindow: Window,
  protocol: ProtoframeDescriptor<P>,
  type: T,
  body: ProtoframeMessageBody<P, T>,
  targetOrigin: string,
): void {
  targetWindow.postMessage(
    mkPayloadBody(protocol, 'tell', type, body),
    targetOrigin,
  );
}

async function ask0<
  P extends Protoframe,
  T extends ProtoframeMessageType<P>,
  B extends ProtoframeMessageBody<P, T>,
  R extends ProtoframeMessageResponse<P, T> & {}
>(
  thisWindow: Window,
  targetWindow: Window,
  protocol: ProtoframeDescriptor<P>,
  type: T,
  body: B,
  targetOrigin: string,
  timeout: number,
): Promise<R> {
  const run = new Promise<R>(async (accept, reject) => {
    const timeoutHandler = setTimeout(
      () => reject(new Error(`Failed to get response within ${timeout}ms`)),
      timeout,
    );
    const response = await awaitResponse(thisWindow, protocol, type);
    clearTimeout(timeoutHandler);
    accept(response);
  });
  targetWindow.postMessage(
    mkPayloadBody(protocol, 'ask', type, body),
    targetOrigin,
  );
  return run;
}

interface AbstractProtoframeSubscriber<P extends Protoframe> {
  handleTell<
    T extends ProtoframeMessageType<P>,
    _R extends ProtoframeMessageResponse<P, T> & undefined
  >(
    type: T,
    handler: (body: ProtoframeMessageBody<P, T>) => void,
  ): void;
}

interface AbstractProtoframePublisher<P extends Protoframe> {
  tell<
    T extends ProtoframeMessageType<P>,
    _R extends ProtoframeMessageResponse<P, T> & undefined
  >(
    type: T,
    body: ProtoframeMessageBody<P, T>,
  ): void;
}

interface AbstractProtoframePubsub<P extends Protoframe>
  extends AbstractProtoframeSubscriber<P>,
    AbstractProtoframePublisher<P> {
  ask<
    T extends ProtoframeMessageType<P>,
    B extends ProtoframeMessageBody<P, T>,
    R extends ProtoframeMessageResponse<P, T> & {}
  >(
    type: T,
    body: B,
    timeout?: number,
  ): Promise<R>;

  handleAsk<
    T extends ProtoframeMessageType<P>,
    R extends ProtoframeMessageResponse<P, T> & {}
  >(
    type: T,
    handler: (body: ProtoframeMessageBody<P, T>) => Promise<R>,
  ): void;
}

export class ProtoframeSubscriber<P extends Protoframe>
  implements AbstractProtoframeSubscriber<P> {
  constructor(
    private readonly protocol: ProtoframeDescriptor<P>,
    private readonly thisWindow: Window = window,
  ) {}

  public handleTell<
    T extends ProtoframeMessageType<P>,
    _R extends ProtoframeMessageResponse<P, T> & undefined
  >(type: T, handler: (body: ProtoframeMessageBody<P, T>) => void): void {
    handleTell0(this.thisWindow, this.protocol, type, handler);
  }
}

export class ProtoframePublisher<P extends Protoframe>
  implements AbstractProtoframePublisher<P> {
  public static parent<P extends Protoframe>(
    protocol: ProtoframeDescriptor<P>,
    iframe: HTMLIFrameElement,
    targetOrigin?: string,
  ): ProtoframePublisher<P> {
    const targetWindow = iframe.contentWindow;
    if (hasValue(targetWindow)) {
      return new ProtoframePublisher(protocol, targetWindow, targetOrigin);
    } else {
      throw new Error('iframe.contentWindow was null');
    }
  }

  public static iframe<P extends Protoframe>(
    protocol: ProtoframeDescriptor<P>,
    targetOrigin?: string,
    targetWindow: Window = window.parent,
  ): ProtoframePublisher<P> {
    return new ProtoframePublisher(protocol, targetWindow, targetOrigin);
  }

  constructor(
    private readonly protocol: ProtoframeDescriptor<P>,
    private readonly targetWindow: Window,
    private readonly targetOrigin: string = '*',
  ) {}

  tell<T extends ProtoframeMessageType<P>, _R extends undefined>(
    type: T,
    body: P[T]['body'],
  ): void {
    tell0(this.targetWindow, this.protocol, type, body, this.targetOrigin);
  }
}

export class ProtoframePubsub<P extends Protoframe>
  implements AbstractProtoframePubsub<P> {
  public static parent<P extends Protoframe>(
    protocol: ProtoframeDescriptor<P>,
    iframe: HTMLIFrameElement,
    targetOrigin = '*',
    thisWindow: Window = window,
  ): ProtoframePubsub<P> {
    const targetWindow = iframe.contentWindow;
    if (hasValue(targetWindow)) {
      return new ProtoframePubsub(
        protocol,
        targetWindow,
        thisWindow,
        targetOrigin,
      );
    } else {
      throw new Error('iframe.contentWindow was null');
    }
  }

  public static iframe<P extends Protoframe>(
    protocol: ProtoframeDescriptor<P>,
    targetOrigin = '*',
    {
      thisWindow = window,
      targetWindow = window.parent,
    }: { thisWindow?: Window; targetWindow?: Window } = {},
  ): ProtoframePubsub<P> {
    return new ProtoframePubsub(
      protocol,
      targetWindow,
      thisWindow,
      targetOrigin,
    );
  }

  constructor(
    private readonly protocol: ProtoframeDescriptor<P>,
    private readonly targetWindow: Window,
    private readonly thisWindow: Window = window,
    private readonly targetOrigin: string = '*',
  ) {}

  public handleTell<
    T extends ProtoframeMessageType<P>,
    _R extends ProtoframeMessageResponse<P, T> & undefined
  >(type: T, handler: (body: ProtoframeMessageBody<P, T>) => void): void {
    handleTell0(this.thisWindow, this.protocol, type, handler);
  }

  public tell<T extends ProtoframeMessageType<P>, _R extends undefined>(
    type: T,
    body: P[T]['body'],
  ): void {
    tell0(this.targetWindow, this.protocol, type, body, this.targetOrigin);
  }

  public handleAsk<
    T extends ProtoframeMessageType<P>,
    R extends P[T]['response'] & {}
  >(type: T, handler: (body: P[T]['body']) => Promise<R>): void {
    handleAsk0(
      this.thisWindow,
      this.targetWindow,
      this.protocol,
      type,
      this.targetOrigin,
      handler,
    );
  }

  public ask<
    T extends ProtoframeMessageType<P>,
    B extends P[T]['body'],
    R extends P[T]['response'] & {}
  >(type: T, body: B, timeout = 10000): Promise<R> {
    return ask0(
      this.thisWindow,
      this.targetWindow,
      this.protocol,
      type,
      body,
      this.targetOrigin,
      timeout,
    );
  }
}
