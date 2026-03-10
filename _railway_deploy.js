/**
 * Deploy lên Railway qua GraphQL API
 * Chạy: node _railway_deploy.js <RAILWAY_TOKEN> <SHEETS_URL>
 */
const https = require('https');

const TOKEN      = process.argv[2] || process.env.RAILWAY_API_TOKEN;
const SHEETS_URL = process.argv[3] || process.env.SHEETS_URL;
const GH_REPO    = 'nguyenngocquy1985-glitch/sidv-zalo-bot';

if (!TOKEN) { console.error('Thiếu RAILWAY_TOKEN'); process.exit(1); }

async function gql(query, variables = {}) {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'backboard.railway.app',
      path:     '/graphql/v2',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { res(JSON.parse(d)); } catch(e) { rej(e); }
      });
    });
    req.on('error', rej);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('1. Kiểm tra tài khoản Railway...');
  const me = await gql('{ me { id name email } }');
  if (me.errors) { console.error('Lỗi token:', me.errors[0].message); process.exit(1); }
  console.log(`   OK — ${me.data.me.name} (${me.data.me.email})`);

  // Lấy workspace (personal account)
  console.log('2. Lấy workspace...');
  const meWs = await gql('{ me { workspaces { id name } } }');
  const wsId   = meWs.data?.me?.workspaces?.[0]?.id;
  const wsName = meWs.data?.me?.workspaces?.[0]?.name;
  if (!wsId) { console.error('Không tìm được workspace:', JSON.stringify(meWs)); process.exit(1); }
  console.log(`   Workspace: ${wsName} (${wsId})`);

  // Kiểm tra project đã tồn tại chưa
  console.log('3. Tạo project sidv-zalo-bot...');
  const projects = await gql(`
    query { projects(workspaceId: "${wsId}") { edges { node { id name } } } }
  `);
  let projectId = projects.data?.projects?.edges?.find(e => e.node.name === 'sidv-zalo-bot')?.node?.id;

  if (!projectId) {
    const create = await gql(`
      mutation {
        projectCreate(input: { name: "sidv-zalo-bot", workspaceId: "${wsId}" }) {
          id name
        }
      }
    `);
    if (create.errors) { console.error('Lỗi tạo project:', create.errors[0].message); process.exit(1); }
    projectId = create.data.projectCreate.id;
    console.log(`   Tạo project mới: ${projectId}`);
  } else {
    console.log(`   Project đã tồn tại: ${projectId}`);
  }

  // Lấy environment ID
  const envs = await gql(`
    query { project(id: "${projectId}") { environments { edges { node { id name } } } } }
  `);
  const envId = envs.data?.project?.environments?.edges?.[0]?.node?.id;
  const envName = envs.data?.project?.environments?.edges?.[0]?.node?.name;
  console.log(`   Environment: ${envName} (${envId})`);

  // Tạo service từ GitHub
  console.log('4. Tạo service từ GitHub...');
  const services = await gql(`
    query { project(id: "${projectId}") { services { edges { node { id name } } } } }
  `);
  let serviceId = services.data?.project?.services?.edges?.[0]?.node?.id;

  if (!serviceId) {
    const svcCreate = await gql(`
      mutation {
        serviceCreate(input: {
          projectId: "${projectId}",
          name: "zalo-bot",
          source: { repo: "${GH_REPO}" }
        }) { id name }
      }
    `);
    if (svcCreate.errors) { console.error('Lỗi tạo service:', svcCreate.errors[0].message); process.exit(1); }
    serviceId = svcCreate.data.serviceCreate.id;
    console.log(`   Service tạo: ${serviceId}`);
  } else {
    console.log(`   Service đã tồn tại: ${serviceId}`);
  }

  // Set environment variables
  if (SHEETS_URL) {
    console.log('5. Set SHEETS_URL...');
    const setVar = await gql(`
      mutation {
        variableUpsert(input: {
          projectId: "${projectId}",
          environmentId: "${envId}",
          serviceId: "${serviceId}",
          name: "SHEETS_URL",
          value: "${SHEETS_URL}"
        })
      }
    `);
    if (setVar.errors) console.warn('   Warn SHEETS_URL:', setVar.errors[0].message);
    else console.log('   OK SHEETS_URL set');
  }

  // Trigger deploy
  console.log('6. Deploy...');
  const deploy = await gql(`
    mutation {
      serviceInstanceDeploy(
        serviceId: "${serviceId}",
        environmentId: "${envId}"
      )
    }
  `);
  if (deploy.errors) {
    // Thử redeploy nếu đã có deployment
    console.log('   Thử redeploy...');
    const redeploy = await gql(`
      mutation {
        serviceInstanceRedeploy(
          serviceId: "${serviceId}",
          environmentId: "${envId}"
        )
      }
    `);
    if (redeploy.errors) console.warn('   Warn deploy:', redeploy.errors[0].message);
    else console.log('   OK Redeploy triggered');
  } else {
    console.log('   OK Deploy triggered');
  }

  console.log('\n=== KẾT QUẢ ===');
  console.log(`Project URL: https://railway.app/project/${projectId}`);
  console.log(`PROJECT_ID:  ${projectId}`);
  console.log(`SERVICE_ID:  ${serviceId}`);
  console.log(`ENV_ID:      ${envId}`);
  console.log('\nBot đang deploy lên Railway!');
  console.log('Sau khi login Zalo (node login.js), chạy lại script này để set ZALO_COOKIES.');
}

main().catch(e => { console.error('Lỗi:', e.message); process.exit(1); });
