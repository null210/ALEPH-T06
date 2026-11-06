// 비밀키 원문이 소스·배포 파일·Git 기록에 남아 있는지 찾는다. 찾으면 실패(종료 코드 1).
//   npm run check:secrets
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const PATTERNS = [
  ['DB 접속 주소(비밀번호 포함)', /postgres(?:ql)?:\/\/[^:\s/"']+:(?!PASSWORD@)[^@\s"']+@/i],
  ['OpenAI/Anthropic 형식 키', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  ['GitHub 토큰', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['AWS 액세스 키', /\bAKIA[0-9A-Z]{16}\b/],
  ['비밀키 블록', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  // 7번: 로그인 세션 쿠키 원문 (확인 기록에는 앞 5글자 + "…생략"만 남겨야 한다)
  ['세션 쿠키 원문', /pds_sid=[A-Za-z0-9_-]{20,}/],
  // 7번: Google OAuth client secret (GitHub secret 은 40자리 16진수라 커밋 해시와 구별되지 않아 이름으로 찾는다)
  ['Google OAuth secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['OAuth client secret 값', /(GITHUB|GOOGLE)_CLIENT_SECRETs*=s*[A-Za-z0-9_-]{16,}/],
];

const findings = [];
function scan(label, content) {
  for (const [name, re] of PATTERNS) if (re.test(content)) findings.push(`${label}: ${name}`);
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.data'].includes(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (statSync(p).size < 2_000_000) scan(p, readFileSync(p, 'utf8'));
  }
}
walk('.');

try {
  const history = execSync('git log -p --all --no-color', { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  scan('Git 기록', history);
} catch {
  console.log('(Git 저장소가 아니어서 기록 검사는 건너뜀)');
}

if (findings.length) {
  console.error('비밀값으로 보이는 글자를 찾았습니다:');
  for (const f of findings) console.error(` - ${f}`);
  process.exit(1);
}
console.log('비밀키 원문을 찾지 못했습니다 (작업 파일·public/·Git 기록).');
