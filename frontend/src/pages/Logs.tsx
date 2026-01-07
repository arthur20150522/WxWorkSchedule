import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Card } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { getLogs, Log } from '../api/log';

const Logs: React.FC = () => {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await getLogs();
      setLogs(res);
    } catch (error) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const columns = [
    {
      title: '操作类型',
      dataIndex: 'action_type',
      key: 'action_type',
      render: (text: string) => <Tag>{text}</Tag>,
    },
    {
      title: '内容/对象',
      dataIndex: 'message_content',
      key: 'message_content',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (text: string) => (
        <Tag color={text === 'success' ? 'green' : 'red'}>
          {text === 'success' ? '成功' : '失败'}
        </Tag>
      ),
    },
    {
      title: '详情/错误',
      dataIndex: 'error_detail',
      key: 'error_detail',
      ellipsis: true,
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => new Date(text).toLocaleString(),
    },
  ];

  return (
    <Card title="操作日志" extra={<Button icon={<ReloadOutlined />} onClick={fetchLogs}>刷新</Button>}>
      <Table
        columns={columns}
        dataSource={logs}
        rowKey="id"
        loading={loading}
      />
    </Card>
  );
};

export default Logs;