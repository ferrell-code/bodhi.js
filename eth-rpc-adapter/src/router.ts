import { ERROR_PATTERN } from '@acala-network/eth-providers';
import { Logger as EthLogger } from '@ethersproject/logger';
import WebSocket from 'ws';
import { Eip1193Bridge } from './eip1193-bridge';
import { InternalError, InvalidParams, JSONRPCError, MethodNotFound } from './errors';
import { RpcForward } from './rpc-forward';
import { JSONRPCResponse } from './transports/types';
export class Router {
  readonly #bridge: Eip1193Bridge;
  readonly #rpcForward?: RpcForward;

  constructor(bridge: Eip1193Bridge, rpcForward?: RpcForward) {
    this.#bridge = bridge;
    this.#rpcForward = rpcForward;
  }

  public async call(methodName: string, params: unknown[], ws?: WebSocket): Promise<Partial<JSONRPCResponse>> {
    if (this.#bridge.isMethodImplemented(methodName)) {
      try {
        return { result: await this.#bridge.send(methodName, params, ws) };
      } catch (err: any) {
        if (JSONRPCError.isJSONRPCError(err)) {
          return { error: err.json() };
        }

        let message = err.message;
        for (const pattern of ERROR_PATTERN) {
          const match = message.match(pattern);
          if (match) {
            const error = this.#bridge.provider.api.registry.findMetaError(new Uint8Array([match[1], match[2]]));
            message = `${error.section}.${error.name}: ${error.docs}`;
            break;
          }
        }

        let error = null;
        if (typeof err === 'object' && err.code) {
          switch (err.code) {
            case EthLogger.errors.INVALID_ARGUMENT:
            case EthLogger.errors.UNSUPPORTED_OPERATION:
              error = new InvalidParams(message);
              break;

            case EthLogger.errors.NOT_IMPLEMENTED:
              error = new InvalidParams(message);
              break;

            case -32603:
            case 1012:
            case 1010:
              error = new InternalError(message);
              break;

            default:
              break;
          }
        }

        return { error: error?.json() || new JSONRPCError(`Error: ${message}`, 6969) };
      }
    } else if (this.#rpcForward && this.#rpcForward.isMethodValid(methodName)) {
      try {
        return { result: await this.#rpcForward.send(methodName, params, ws) };
      } catch (err: any) {
        return { error: new JSONRPCError(err.message, 6969) };
      }
    } else {
      return { error: new MethodNotFound('Method not found', `The method ${methodName} does not exist`).json() };
    }
  }

  public isMethodImplemented(methodName: string): boolean {
    return this.#rpcForward
      ? this.#bridge.isMethodImplemented(methodName) || this.#rpcForward.isMethodValid(methodName)
      : this.#bridge.isMethodImplemented(methodName);
  }
}
