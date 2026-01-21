
export class MockBot {
    public isLoggedIn: boolean = true;
    public name: string = 'MockBot';

    constructor(name: string) {
        this.name = name;
    }

    // Mock currentUser
    public get currentUser() {
        return {
            name: () => 'Test User',
            id: 'wxid_testuser123'
        };
    }

    // Mock Room
    public get Room() {
        return {
            findAll: async () => {
                return [
                    {
                        id: 'room_001',
                        topic: async () => '产品研发部',
                        memberAll: async () => new Array(15) // Mock 15 members
                    },
                    {
                        id: 'room_002',
                        topic: async () => '周末约球群',
                        memberAll: async () => new Array(8)
                    },
                    {
                        id: 'room_003',
                        topic: async () => '家庭群',
                        memberAll: async () => new Array(6)
                    },
                    {
                        id: 'room_004',
                        topic: async () => '测试报警群',
                        memberAll: async () => new Array(3)
                    }
                ];
            }
        };
    }

    // Mock Contact
    public get Contact() {
        return {
            findAll: async () => {
                return [
                    {
                        id: 'contact_001',
                        name: () => '张三',
                        friend: () => true,
                        type: () => 1 // Unknown/Personal
                    },
                    {
                        id: 'contact_002',
                        name: () => '李四',
                        friend: () => true,
                        type: () => 1
                    },
                    {
                        id: 'contact_003',
                        name: () => '文件传输助手',
                        friend: () => true,
                        type: () => 1
                    },
                    {
                        id: 'contact_004',
                        name: () => '王五 (非好友)',
                        friend: () => false,
                        type: () => 1
                    }
                ];
            }
        };
    }

    // Event listeners - do nothing
    public on(event: string, listener: (...args: any[]) => void) {
        return this;
    }

    // Lifecycle
    public async start() {
        console.log('[MockBot] Started');
    }

    public async stop() {
        console.log('[MockBot] Stopped');
    }
}
