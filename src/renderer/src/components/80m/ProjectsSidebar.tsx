import React, { useState, useEffect } from "react";
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Plus,
} from "lucide-react";

interface FileNode {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface FileTreeNodeProps {
  node: FileNode;
  level: number;
  onFileClick: (path: string) => void;
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node,
  level,
  onFileClick,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);

  const toggleExpand = async () => {
    if (!node.isDirectory) {
      onFileClick(node.path);
      return;
    }

    if (!expanded) {
      setLoading(true);
      try {
        const entries = await window.hermesAPI.readDirectory(node.path);
        setChildren(entries);
      } catch (err) {
        console.error("Failed to read directory", err);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div>
      <div
        className="file-tree-item"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={toggleExpand}
      >
        {node.isDirectory ? (
          <span className="file-tree-icon">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {expanded ? (
              <FolderOpen size={14} style={{ marginLeft: 4 }} color="#4ade80" />
            ) : (
              <Folder size={14} style={{ marginLeft: 4 }} color="#e8e8e8" />
            )}
          </span>
        ) : (
          <span className="file-tree-icon" style={{ marginLeft: 18 }}>
            <FileText size={14} color="#aaa" />
          </span>
        )}
        <span className="file-tree-name">{node.name}</span>
        {loading && <span className="file-tree-loading">...</span>}
      </div>
      {expanded && node.isDirectory && (
        <div className="file-tree-children">
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface ProjectsSidebarProps {
  activeProject: string | null;
  onProjectChange: (path: string | null) => void;
  onFileClick: (path: string) => void;
}

const ProjectsSidebar: React.FC<ProjectsSidebarProps> = ({
  activeProject,
  onProjectChange,
  onFileClick,
}) => {
  const [rootFiles, setRootFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeProject) {
      setLoading(true);
      window.hermesAPI
        .readDirectory(activeProject)
        .then((entries) => setRootFiles(entries))
        .catch((err) => console.error("Failed to read project root", err))
        .finally(() => setLoading(false));
    } else {
      setRootFiles([]);
    }
  }, [activeProject]);

  const handleSelectFolder = async () => {
    const path = await window.hermesAPI.selectProjectDirectory();
    if (path) {
      onProjectChange(path);
    }
  };

  const projectName = activeProject
    ? activeProject.split("/").pop() || activeProject.split("\\").pop()
    : "";

  if (!activeProject) {
    return (
      <div className="projects-sidebar-collapsed">
        <button
          className="projects-add-btn projects-add-btn-collapsed"
          onClick={handleSelectFolder}
          title="Open Project Folder"
        >
          <Folder size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="projects-sidebar">
      <div className="projects-sidebar-header">
        <h3>WORKSPACE</h3>
        <button
          className="projects-add-btn"
          onClick={handleSelectFolder}
          title="Open Project Folder"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="projects-sidebar-content">
        {loading ? (
          <div className="projects-loading">Loading...</div>
        ) : (
          <div className="file-tree-root">
            <div className="file-tree-project-name">
              <FolderOpen
                size={14}
                style={{ marginRight: 6 }}
                color="#4ade80"
              />
              {projectName}
            </div>
            {rootFiles.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                level={1}
                onFileClick={onFileClick}
              />
            ))}
            <div style={{ marginTop: 24, padding: "0 8px" }}>
              <button
                onClick={() => onProjectChange(null)}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,100,100,0.3)",
                  color: "#ff6666",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  fontSize: "10px",
                  cursor: "pointer",
                  width: "100%",
                  fontFamily: "'Fira Code', monospace",
                }}
              >
                CLOSE WORKSPACE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectsSidebar;
