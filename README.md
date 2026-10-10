# World Agent Wallet

**에이전트에 연결하는 MCP 결제 플러그인. 여러 에이전트의 예산, 사람의 승인, 결제 내역을 한곳에서 관리합니다.**

World ID · AgentBook · World Chain USDC · x402 · MCP

독립 개발 프로젝트이며 World의 공식 제품이 아닙니다.

![Operator dashboard](docs/dashboard.png)

## v0.1.0 목표와 완료 범위

**API 키 없이 실행되는 로컬 MVP**와 **World/x402를 연결할 수 있는 실제 어댑터**를 제공합니다. 사용자가 설정한 한도를 서버에서 검사하고, 에이전트는 승인·한도 변경 권한을 갖지 않습니다.

| 기능               | 구현 및 검증 범위                                                                       |
| ------------------ | --------------------------------------------------------------------------------------- |
| MCP stdio 플러그인 | 공식 MCP SDK 클라이언트로 검색·결제·승인 후 재개·영수증 조회 통합 테스트                |
| 공유 예산          | USDC 정수 단위, SQLite 트랜잭션, 동시 요청 한도 검증                                    |
| 사용자 승인        | 금액·서비스·입력·유효기간·정책 버전에 결합된 승인                                       |
| World ID           | IDKit 4.4.0, 서버 RP 서명, Proof of Human 검증, 등록된 승인자 일치 검사                 |
| AgentBook          | 서명 지갑의 World Chain 등록 조회 및 AgentKit 무료 접근 시도                            |
| x402               | v2 exact / World Chain / USDC / EIP-3009. 실제 SDK 서명 및 RPC 응답 fixture로 정산 검증 |
| 운영 화면          | 승인·거절, 공유 한도, 에이전트 발급·회수, 내역, 모바일 레이아웃                         |
| 장애 처리          | 중복 실행 억제, 재시작 후 불확실 상태 보존, 자동 재결제 금지                            |

**실제 World ID 앱 인증과 메인넷 송금은 실행하지 않았습니다.** 해당 기능은 사용자 앱 설정·인증된 지갑·자금·호환 API가 필요합니다. 인증/체인 응답을 대체한 테스트와 실제 서명 SDK 테스트를 통과한 연동 코드이며, 실자금 운영 전 통합 검증이 필요합니다.

## 빠른 실행

Node.js **24 이상**이 필요합니다. 데이터베이스는 Node 내장 SQLite를 사용합니다.

```bash
npm ci
npm run build
npm start
```

1. `http://127.0.0.1:8787`을 엽니다.
2. 처음 실행할 때 생성되는 `.local/admin-token` 파일의 값을 운영자 로그인 화면에 붙여 넣습니다.
3. **에이전트 요청 체험**에서 `Market snapshot`을 실행하면 0.2 USDC가 시뮬레이션됩니다.
4. `BESS strategy check`를 실행하면 2 USDC 승인 요청이 생성됩니다.
5. 승인하면 실행되고, 영수증 및 남은 예산이 갱신됩니다.

기본값은 하루 **5 USDC**, 자동 결제 **건당 1 USDC**, 날짜 경계는 **Asia/Seoul**입니다. 금액은 데모 원장의 숫자이며 자금 이동은 없습니다. World ID를 등록하지 않은 데모에서는 별도 운영자 토큰이 승인을 담당합니다.

화면 없이도 전체 흐름을 확인할 수 있습니다.

```bash
npm run demo
```

인증 파일과 DB는 `.local/`에 저장되고 Git에서 제외됩니다. 운영자 토큰과 에이전트 토큰은 서로 다릅니다. 에이전트에는 `agent-research.json` 또는 `agent-operations.json`만 전달하세요.

## 에이전트에 연결

먼저 `npm start`로 게이트웨이를 실행합니다. MCP stdio를 지원하는 호스트의 설정에 다음을 추가하고, 경로를 실제 절대 경로로 변경합니다.

```json
{
  "mcpServers": {
    "world-agent-wallet": {
      "command": "node",
      "args": ["/absolute/path/world-agent-wallet/src/mcp.mjs"],
      "env": {
        "WALLET_GATEWAY_URL": "http://127.0.0.1:8787",
        "WALLET_AGENT_FILE": "/absolute/path/world-agent-wallet/.local/agent-research.json"
      }
    }
  }
}
```

Windows에서는 `C:/projects/world-agent-wallet/...` 같은 절대 경로를 사용합니다. MCP 프로세스에는 운영자 토큰과 지갑 개인키를 전달하지 않습니다. 이 릴리스는 **stdio MCP**를 제공하며, 클라우드 호스트용 Streamable HTTP/OAuth 배포는 포함하지 않습니다.

에이전트에게 다음처럼 요청할 수 있습니다.

> wallet_status로 예산을 확인하고 market-snapshot을 한 번 구매해 줘. prepare_payment에 고유한 idempotency_key를 지정하고, ready이면 execute_payment를 실행해. 승인 대기이면 나에게 알려주고 승인 이후 같은 operation_id로 이어서 실행해.

| 도구              | 역할                                           |
| ----------------- | ---------------------------------------------- |
| `wallet_status`   | 내 에이전트 상태와 공유 예산                   |
| `list_services`   | 운영자가 허용한 서비스와 가격 상한             |
| `prepare_payment` | 입력 검증, 가격 조회, 실행 준비 또는 승인 대기 |
| `execute_payment` | 이미 생성된 작업을 예산·승인 검사 후 실행      |
| `get_receipt`     | 특정 작업의 상태와 결과                        |
| `list_receipts`   | 해당 에이전트의 최근 작업                      |

`prepare_payment`는 결제하지 않지만, 외부 제공자의 무료 체험 API 호출은 소비할 수 있습니다. 같은 요청을 재시도할 때는 **같은 idempotency_key**를 사용하세요. `execute_payment`의 성공 응답을 놓쳤다면 같은 operation_id로 영수증을 조회합니다.

## World와 실제 결제 연결

자세한 절차는 [docs/world-integration.md](docs/world-integration.md)를 참고하세요.

1. World Developer Portal에서 앱/RP를 등록하고 `.env`에 World 설정을 입력합니다.
2. 대시보드에서 소유자의 World ID를 등록합니다. 이후 승인은 같은 사람이 수행해야 합니다.
3. 실제 결제용 전용 지갑을 AgentBook에 등록합니다.
4. `examples/services.live.json`을 복사해 **직접 신뢰하는 API의 정확한 URL·수취인·가격 상한**을 설정합니다.
5. 별도의 데이터 디렉터리와 `WALLET_MODE=x402`, production World 환경을 사용합니다.

`.env.example`에는 빈 설정 예시만 들어 있습니다. 데모 데이터 디렉터리를 실결제에 재사용할 수 없습니다. 모델 API는 사용하지 않으므로 LLM 공급자 API 키가 필요하지 않습니다.

## 검증

```bash
npm run check
npm test
npm run build
npm run demo
```

테스트는 실제 자금을 사용하지 않습니다. 동시 지출, 승인 위변조, 다른 사람의 승인, 중복 결제, 에이전트별 접근, 정책 변경, 만료, 재시작, World ID 응답 검증, x402 SDK 서명과 MCP 전 과정을 검사합니다. [검증 기록](docs/validation.md)에 범위와 남은 검증을 기록했습니다.

## 운영 모델과 범위

- 한 명의 운영자, 여러 에이전트, 하나의 지갑·공유 예산을 전제로 합니다. AgentBook 등록은 **공유 서명 지갑** 단위이고, 플러그인 내부 에이전트별 키 발급은 아닙니다.
- 비용은 **결제 권한을 발행한 날짜**에 예약합니다. 체인 정산 날짜와 다를 수 있습니다. 수수료·외부 지갑 사용은 이 예산에 포함되지 않습니다.
- 게이트웨이를 거치는 요청만 통제합니다. 외부 결제 도구나 지갑을 직접 사용하는 행위는 통제할 수 없습니다.
- 기본 서버는 loopback에만 바인딩합니다. 원격 배포는 별도 TLS·인증·키 관리·라우팅 검토가 필요합니다.
- 서버의 개인키와 운영자 토큰에 접근 가능한 프로세스는 신뢰 경계 안에 있습니다. 강한 격리가 필요하면 에이전트와 게이트웨이를 다른 계정/호스트에서 운영해야 합니다.
- 실결제는 운영자가 등록한 **읽기 전용 GET API**만 지원합니다. 임의 URL, 토큰 전송, 스왑, 스마트계약 호출은 노출하지 않습니다.
- 공개 체인상 기록과 AgentBook의 사람 연결은 별개의 개인정보 특성을 갖습니다. 애플리케이션 전체에 익명성이 자동으로 보장되는 것은 아닙니다.

설계는 [architecture.md](docs/architecture.md), 보안 경계는 [SECURITY.md](SECURITY.md), 향후 범위는 [ROADMAP.md](ROADMAP.md)를 참고하세요.

## 공식 자료

- [World AgentKit](https://docs.world.org/agents/agent-kit/integrate)
- [World ID / IDKit](https://docs.world.org/world-id/idkit/integrate)
- [World approval integration](https://docs.world.org/agents/human-in-the-loop/integrate)
- [x402 buyer integration](https://docs.x402.org/getting-started/quickstart-for-buyers)
- [MCP server development](https://modelcontextprotocol.io/docs/develop/build-server)

설계 기준: 2026-10-10에 확인한 공식 문서 및 `package-lock.json`에 고정된 패키지.
