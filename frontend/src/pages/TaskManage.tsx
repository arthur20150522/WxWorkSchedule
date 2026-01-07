import React, { useEffect, useState } from 'react';
import { Table, Tag, Button, Space, message, Modal, Tooltip } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { getTasks, updateTaskStatus, deleteTask, Task } from '../api/task';
import dayjs from 'dayjs';

const TaskManage: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const res = await getTasks();
      setTasks(res);
    } catch (error) {
      message.error('获取任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleStatusChange = async (record: Task) => {
    const newStatus = record.status === 'active' ? 'inactive' : 'active';
    try {
      await updateTaskStatus(record.id, newStatus);
      message.success(`任务已${newStatus === 'active' ? '启用' : '停用'}`);
      fetchTasks();
    } catch (error) {
      message.error('操作失败');
    }
  };

  const handleDelete = (record: Task) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除任务 "${record.name}" 吗？`,
      onOk: async () => {
        try {
          await deleteTask(record.id);
          message.success('删除成功');
          fetchTasks();
        } catch (error) {
          message.error('删除失败');
        }
      },
    });
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '发送内容',
      dataIndex: 'message_content',
      key: 'message_content',
      ellipsis: true,
    },
    {
      title: '计划时间',
      dataIndex: 'schedule_time',
      key: 'schedule_time',
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '重复类型',
      dataIndex: 'repeat_type',
      key: 'repeat_type',
      render: (type: string) => {
        const map: any = {
          once: '单次',
          daily: '每天',
          weekly: '每周',
          monthly: '每月',
        };
        return <Tag>{map[type] || type}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const color = status === 'active' ? 'green' : status === 'inactive' ? 'orange' : 'red';
        const text = status === 'active' ? '运行中' : status === 'inactive' ? '已停止' : status;
        return <Tag color={color}>{text}</Tag>;
      },
    },
    {
      title: '下次执行',
      dataIndex: 'next_execution_time',
      key: 'next_execution_time',
      render: (text: string) => text ? dayjs(text).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Task) => (
        <Space size="middle">
          <Tooltip title={record.status === 'active' ? '暂停任务' : '启用任务'}>
            <Button
              type="text"
              icon={record.status === 'active' ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => handleStatusChange(record)}
              style={{ color: record.status === 'active' ? '#faad14' : '#52c41a' }}
            />
          </Tooltip>
          <Tooltip title="删除任务">
            <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <h2>任务管理</h2>
        <Button icon={<ReloadOutlined />} onClick={fetchTasks}>刷新</Button>
      </div>
      <Table
        columns={columns}
        dataSource={tasks}
        rowKey="id"
        loading={loading}
      />
    </div>
  );
};

export default TaskManage;