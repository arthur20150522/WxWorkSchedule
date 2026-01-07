import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Groups from './pages/Groups';
import MessageEdit from './pages/MessageEdit';
import TaskSchedule from './pages/TaskSchedule';
import TaskManage from './pages/TaskManage';
import Logs from './pages/Logs';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/" element={<MainLayout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="groups" element={<Groups />} />
          <Route path="message/edit" element={<MessageEdit />} />
          <Route path="tasks/schedule" element={<TaskSchedule />} />
          <Route path="tasks/manage" element={<TaskManage />} />
          <Route path="logs" element={<Logs />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;