/**
 * Quick smoke test — validates the core flow with MockBot.
 * Run: USE_MOCK_BOT=true npx tsx test/smoke.ts
 */
import 'dotenv/config';
process.env.USE_MOCK_BOT = 'true';

import { BotManager } from '../src/botManager.js';
import { DBManager, addLog } from '../src/dbManager.js';
import { UserManager } from '../src/userManager.js';
import { TaskQueue } from '../src/taskQueue.js';

const USER = 'admin';

async function main() {
  console.log('=== WxSchedule Smoke Test (MockBot mode) ===\n');

  // 1. Bot init
  const bot = BotManager.getBot(USER);
  console.log(`1. Bot initialized: isLoggedIn=${bot.isLoggedIn}`);

  // 2. Current user
  console.log(`2. Current user: ${bot.currentUser.name()} (${bot.currentUser.id})`);

  // 3. Groups
  const rooms = await bot.Room.findAll();
  console.log(`3. Groups: ${rooms.length} found`);
  for (const r of rooms) {
    console.log(`   - ${await r.topic()} (${(await r.memberAll()).length} members)`);
  }

  // 4. Contacts
  const contacts = await bot.Contact.findAll();
  console.log(`4. Contacts: ${contacts.length} found`);
  for (const c of contacts) {
    console.log(`   - ${c.name()} (friend=${c.friend()})`);
  }

  // 5. Cache
  BotManager.cacheRooms(USER, rooms);
  BotManager.cacheContacts(USER, contacts);
  const cached = BotManager.getCachedRoom(USER, 'room_001');
  console.log(`5. Cache hit for room_001: ${cached ? 'YES' : 'NO'}`);

  // 6. Task execution via queue
  const db = await DBManager.getDb(USER);
  const task = {
    id: 'smoke_test_001',
    type: 'text' as const,
    targetType: 'group' as const,
    targetId: 'room_001',
    targetName: '产品研发部',
    content: ['[Smoke Test] Hello from wx4py migration!'],
    currentContentIndex: 0,
    scheduleTime: new Date().toISOString(),
    recurrence: 'once' as const,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  };
  await db.update(({ tasks }) => tasks.push(task));
  console.log(`6. Task created: ${task.id}`);

  // 7. Send via mock
  const queue = TaskQueue.getInstance(USER);
  queue.add(task);
  await new Promise(r => setTimeout(r, 2000));
  console.log('7. Task executed (check logs above)');

  // 8. Cleanup
  await db.update(({ tasks }) => {
    const idx = tasks.findIndex(t => t.id === 'smoke_test_001');
    if (idx > -1) tasks.splice(idx, 1);
  });

  console.log('\n=== Smoke Test PASSED ===');
}

main().catch(e => {
  console.error('Smoke test FAILED:', e);
  process.exit(1);
});
