import React, { useEffect, useState } from 'react';
import { Table, Button, Input, message, Card } from 'antd';
import { SyncOutlined, SearchOutlined } from '@ant-design/icons';
import { getGroups, syncGroups, Group } from '../api/group';

const Groups: React.FC = () => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchText, setSearchText] = useState('');

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const res = await getGroups({ search: searchText });
      setGroups(res);
    } catch (error) {
      message.error('获取群组列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [searchText]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      await syncGroups();
      message.success('同步成功');
      fetchGroups();
    } catch (error) {
      message.error('同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const columns = [
    {
      title: '群组名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Chat ID',
      dataIndex: 'chat_id',
      key: 'chat_id',
    },
    {
      title: '成员数量',
      dataIndex: 'member_count',
      key: 'member_count',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString(),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <h2>群组管理</h2>
        <div style={{ display: 'flex', gap: 16 }}>
          <Input 
            placeholder="搜索群组..." 
            prefix={<SearchOutlined />} 
            onChange={e => setSearchText(e.target.value)}
            style={{ width: 200 }}
          />
          <Button 
            type="primary" 
            icon={<SyncOutlined spin={syncing} />} 
            onClick={handleSync}
            loading={syncing}
          >
            同步企业微信群组
          </Button>
        </div>
      </div>
      <Table
        columns={columns}
        dataSource={groups}
        rowKey="id"
        loading={loading}
      />
    </div>
  );
};

export default Groups;