import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { Upload, ChevronLeft, ChevronRight, Settings2, List, Maximize, Minimize, X, BookOpen, ChevronDown, ChevronUp, BookmarkPlus, LogIn, Library as LibraryIcon, Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { apiFetch, apiFetchUpload, getToken } from "../utils/apiClient";

interface Chapter {
  title: string;
  content: string;
  gaidenBadge?: string | null;
}

interface BookRecord {
  id: number;
  file_name: string;
  novel_name: string;
  total_chapters: number;
  current_chapter: number;
  font_size: number;
  reader_theme: string;
}

export function NovelReader() {
  const [searchParams, setSearchParams] = useSearchParams();

  const bookIdParam = searchParams.get("bookId");

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState(0);
  const [novelName, setNovelName] = useState<string>("");
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('novel_reader_font_size');
    return saved ? parseInt(saved, 10) : 18;
  });
  const [readerTheme, setReaderTheme] = useState<"light" | "sepia" | "dark" | "gray" | "green">(() => {
    const saved = localStorage.getItem('novel_reader_theme');
    return (saved as any) || "light";
  });
  const [showSettings, setShowSettings] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showChapterList, setShowChapterList] = useState(false);
  const [showFormatInfo, setShowFormatInfo] = useState(false);

  // 近期書籍選單
  const [showRecentBooks, setShowRecentBooks] = useState(false);
  const [recentBooks, setRecentBooks] = useState<BookRecord[]>([]);
  const recentBtnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  // 書籤/筆記面板
  const [showBookmarkPanel, setShowBookmarkPanel] = useState(false);
  const [bookmarkNote, setBookmarkNote] = useState("");

  const [toast, setToast] = useState("");

  // 後端書籍記錄
  const [currentBookRecord, setCurrentBookRecord] = useState<BookRecord | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  const readerRef = useRef<HTMLDivElement>(null);
  const { isAuthenticated } = useAuth();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }, []);

  // 載入近期書籍
  const fetchRecentBooks = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const books = await apiFetch<BookRecord[]>("/api/books");
      setRecentBooks(books);
    } catch {
      // 忽略錯誤
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchRecentBooks();
  }, [fetchRecentBooks]);

  // 計算下拉位置 & 點擊外部關閉
  const openRecentBooks = useCallback(() => {
    if (recentBtnRef.current) {
      const rect = recentBtnRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 6, left: rect.left });
    }
    setShowRecentBooks(true);
  }, []);

  useEffect(() => {
    if (!showRecentBooks) return;
    const handleClose = (e: MouseEvent) => {
      // 關閉選單（portal 內的點擊由各 button 自己處理）
      const target = e.target as HTMLElement;
      if (!target.closest(".recentBooksDropdown") && !recentBtnRef.current?.contains(target)) {
        setShowRecentBooks(false);
      }
    };
    document.addEventListener("mousedown", handleClose);
    return () => document.removeEventListener("mousedown", handleClose);
  }, [showRecentBooks]);

  // 取得外傳 Badge 名稱（null 表示非外傳）
  const getGaidenBadgeName = (title: string): string | null => {
    // 例外：特別SS (無論在哪都標示)
    if (title.includes("特別SS") || title.includes("特別ＳＳ") || title.includes("SS") || title.includes("ＳＳ")) {
      return "特別SS";
    }

    if (!/外伝|外傳|番外編|番外篇|編|篇/.test(title)) return null;

    // 尋找章節編號前的字串
    const chapNumRegex = /(?:第[〇一二三四五六七八九十百千万零０-９0-9]+[章話回節]|第?[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+話)/;
    const match = title.match(new RegExp(`^(.*?)${chapNumRegex.source}`));
    
    let prefix = "";
    if (match) {
      prefix = match[1];
    } else {
      prefix = title;
    }

    // 清理尾部符號
    prefix = prefix.replace(/[・\s\-]+$/, '').trim();

    if (prefix) {
      // 確保擷取出的 prefix 中確實包含外傳關鍵字
      if (/外伝|外傳|番外編|番外篇|編|篇/.test(prefix)) {
        if (prefix !== title) {
          // 標題中有章節號，且前面有前綴，前綴就是 badge
          return prefix === "番外編" ? "番外篇" : prefix;
        }
      } else {
        // 前綴不包含外傳關鍵字（表示外傳字眼出現在章節號之後），依據需求不標示
        return null;
      }
    }

    // 針對沒有章節號、或前綴直接是標題的情況
    const gaidenMatch = title.match(/^(.*?)(?:外伝|外傳)/);
    if (gaidenMatch) {
      const p = gaidenMatch[1].trim();
      if (p) return p;
    }

    if (title.includes("番外編") || title.includes("番外篇")) return "番外篇";

    const henMatch = title.match(/^(.*?)(?:編|篇)/);
    if (henMatch) {
      const p = henMatch[1].trim();
      if (p) return p;
    }

    return null;
  };

  // 章節分割邏輯
  const splitTextIntoChapters = (text: string): Chapter[] => {
    const rawLines = text.split('\n');

    // ── 主要分割法：偵測「【...】」後緊跟「---（5個以上）」的行組 ──
    const chapterStarts: number[] = [];
    for (let i = 0; i < rawLines.length - 1; i++) {
      const curr = rawLines[i].replace(/\r$/, '').trim();
      const next = rawLines[i + 1].replace(/\r$/, '').trim();
      if (/^【.+】$/.test(curr) && /^-{5,}$/.test(next)) {
        chapterStarts.push(i);
      }
    }

    if (chapterStarts.length > 0) {
      const rawChapters: Chapter[] = [];

      for (let ci = 0; ci < chapterStarts.length; ci++) {
        const si = chapterStarts[ci];
        const ei = ci + 1 < chapterStarts.length ? chapterStarts[ci + 1] : rawLines.length;
        const titleRaw = rawLines[si].replace(/\r$/, '').trim();
        const title = titleRaw.replace(/^【/, '').replace(/】$/, '').trim();
        // 跳過標題行(si)與分隔線行(si+1)，其餘為內容
        const contentLines = rawLines.slice(si + 2, ei);
        const content = contentLines.map(l => l.replace(/\r$/, '')).join('\n').trim();
        rawChapters.push({ title, content, gaidenBadge: getGaidenBadgeName(title) });
      }

      return rawChapters;
    }

    // ── 備用分割法：增強版 regex，支援全形數字、特殊符號數字、「話」等 ──
    // 支援：第X章/回/節/話（X 可為半形、全形、漢字數字）、Chapter N
    const chapterRegex = /(?=第[〇一二三四五六七八九十百千万零０-９0-9]+[章話回節][\s　\u3000]|第[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+話|Chapter\s+\d+)/g;
    const parts = text.split(chapterRegex);

    if (parts.length === 1) {
      return [{ title: '開始閱讀', content: parts[0], gaidenBadge: null }];
    }

    return parts
      .map((part, index) => {
        const ls = part.trim().split('\n');
        const title = ls[0].trim() || `第 ${index + 1} 章`;
        const content = ls.slice(1).join('\n').trim();
        return { title, content, gaidenBadge: getGaidenBadgeName(title) };
      })
      .filter(c => c.content.length > 0);
  };

  // 當網址帶有 bookId 時，嘗試從後端下載檔案
  const loadBookFromServer = useCallback(async (id: number) => {
    if (!isAuthenticated) return;
    setIsLoadingFile(true);
    try {
      // 先找出該本書的 metadata
      let bookMeta = recentBooks.find(b => b.id === id);
      if (!bookMeta) {
        const books = await apiFetch<BookRecord[]>("/api/books");
        setRecentBooks(books);
        bookMeta = books.find(b => b.id === id);
      }

      if (!bookMeta) throw new Error("找不到該書籍紀錄");

      // 下載檔案 (使用 fetch 帶上 token)
      const token = getToken();
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${baseUrl}/api/books/${id}/download`, {
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error("下載檔案失敗");

      const text = await res.text();
      const finalChapters = splitTextIntoChapters(text);

      setNovelName(bookMeta.file_name);
      setChapters(finalChapters);
      setCurrentBookRecord(bookMeta);

      // 恢復設定
      const urlChapterIndex = searchParams.get("chapterIndex");
      if (urlChapterIndex !== null) {
        setCurrentChapter(parseInt(urlChapterIndex, 10));
      } else {
        setCurrentChapter(bookMeta.current_chapter);
      }
      if (bookMeta.font_size) setFontSize(bookMeta.font_size);
      if (bookMeta.reader_theme) setReaderTheme(bookMeta.reader_theme as any);

    } catch (err) {
      showToast("❌ 讀取雲端書籍失敗");
    } finally {
      setIsLoadingFile(false);
    }
  }, [isAuthenticated, recentBooks, showToast]);

  useEffect(() => {
    if (bookIdParam && isAuthenticated) {
      loadBookFromServer(parseInt(bookIdParam, 10));
    }
  }, [bookIdParam, isAuthenticated]); // 避免 recentBooks 變更一直觸發

  // 儲存進度到後端
  const syncProgressToBackend = useCallback(async (bookRecord: BookRecord, chapterIdx: number) => {
    if (!isAuthenticated || !bookRecord) return;
    try {
      await apiFetch(`/api/books/${bookRecord.id}`, {
        method: "PUT",
        body: JSON.stringify({ current_chapter: chapterIdx }),
      });

      // 更新 local state 的 recentBooks 讓選單保持最新
      setRecentBooks(prev => prev.map(b => b.id === bookRecord.id ? { ...b, current_chapter: chapterIdx } : b));
    } catch {
      // 靜默失敗
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (novelName && chapters.length > 0 && !isLoadingFile) {
      localStorage.setItem(`novel_progress_${novelName}`, currentChapter.toString());
      if (currentBookRecord) {
        syncProgressToBackend(currentBookRecord, currentChapter);
      }
    }
  }, [novelName, currentChapter, chapters.length, currentBookRecord, syncProgressToBackend, isLoadingFile]);

  useEffect(() => {
    localStorage.setItem('novel_reader_font_size', fontSize.toString());
    if (isAuthenticated && currentBookRecord) {
      apiFetch(`/api/books/${currentBookRecord.id}`, {
        method: "PUT",
        body: JSON.stringify({ font_size: fontSize }),
      }).catch(() => { });
    }
  }, [fontSize, isAuthenticated, currentBookRecord]);

  useEffect(() => {
    localStorage.setItem('novel_reader_theme', readerTheme);
    if (isAuthenticated && currentBookRecord) {
      apiFetch(`/api/books/${currentBookRecord.id}`, {
        method: "PUT",
        body: JSON.stringify({ reader_theme: readerTheme }),
      }).catch(() => { });
    }
  }, [readerTheme, isAuthenticated, currentBookRecord]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingFile(true);
    setSearchParams({}); // 清除網址上的 bookId，避免混淆

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const finalChapters = splitTextIntoChapters(text);
      setNovelName(file.name);
      setChapters(finalChapters);

      if (isAuthenticated) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("total_chapters", finalChapters.length.toString());
          formData.append("font_size", fontSize.toString());
          formData.append("reader_theme", readerTheme);

          const bookData = await apiFetchUpload<BookRecord>("/api/books/upload", formData);
          setCurrentBookRecord(bookData);
          setCurrentChapter(bookData.current_chapter);
          if (bookData.font_size) setFontSize(bookData.font_size);
          if (bookData.reader_theme) setReaderTheme(bookData.reader_theme as any);

          showToast("✅ 書籍已上傳並同步至書庫");
          fetchRecentBooks(); // 重新整理選單
          setSearchParams({ bookId: bookData.id.toString() }); // 更新網址
        } catch (err) {
          showToast("❌ 上傳至雲端失敗，將以本地模式開啟");
          setCurrentBookRecord(null);
          const savedProgress = localStorage.getItem(`novel_progress_${file.name}`);
          setCurrentChapter(savedProgress ? parseInt(savedProgress, 10) : 0);
        }
      } else {
        const savedProgress = localStorage.getItem(`novel_progress_${file.name}`);
        setCurrentChapter(savedProgress ? parseInt(savedProgress, 10) : 0);
        setCurrentBookRecord(null);
      }
      setIsLoadingFile(false);
    };
    reader.readAsText(file);
  };

  const loadSampleNovel = async () => {
    setSearchParams({}); // 清除網址
    try {
      setIsLoadingFile(true);
      const response = await fetch(`${import.meta.env.BASE_URL}sample-novel.txt`);
      if (!response.ok) throw new Error('Network response was not ok');
      const text = await response.text();
      const finalChapters = splitTextIntoChapters(text);
      setNovelName('sample-novel.txt');
      setChapters(finalChapters);
      setCurrentBookRecord(null);

      const savedProgress = localStorage.getItem(`novel_progress_sample-novel.txt`);
      setCurrentChapter(savedProgress ? parseInt(savedProgress, 10) : 0);
    } catch (error) {
      console.error('Failed to load sample novel:', error);
      alert('無法載入範例小說。');
    } finally {
      setIsLoadingFile(false);
    }
  };

  useEffect(() => {
    if (readerRef.current) readerRef.current.scrollTop = 0;
  }, [currentChapter]);

  useEffect(() => {
    if (showChapterList) {
      setTimeout(() => {
        document.getElementById(`chapter-${currentChapter}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 50);
    }
  }, [showChapterList, currentChapter]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = (e.target as HTMLElement)?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || isEditable) return;
      if (chapters.length === 0) return;

      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setCurrentChapter(c => Math.max(0, c - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setCurrentChapter(c => Math.min(chapters.length - 1, c + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chapters]);

  const handleAddBookmark = async () => {
    if (!currentBookRecord) return;
    try {
      await apiFetch(`/api/books/${currentBookRecord.id}/bookmarks`, {
        method: "POST",
        body: JSON.stringify({
          chapter_index: currentChapter,
          title: chapters[currentChapter]?.title || `第 ${currentChapter + 1} 章`,
          note: bookmarkNote || null,
        }),
      });
      showToast("✅ 書籤已新增");
      setShowBookmarkPanel(false);
      setBookmarkNote("");
    } catch {
      showToast("❌ 新增書籤失敗");
    }
  };


  const getThemeStyles = () => {
    switch (readerTheme) {
      case "sepia": return { backgroundColor: "#f4ecd8", color: "#433422" };
      case "dark": return { backgroundColor: "#1a1a1a", color: "#e0e0e0" };
      case "gray": return { backgroundColor: "#d9d5d5ff", color: "#333333" };
      case "green": return { backgroundColor: "#acefb9ff", color: "#1b4d26" };
      default: return { backgroundColor: "#ffffff", color: "#333333" };
    }
  };

  return (
    <section id="reader" className="section section--alt">
      <div className="container">
        <div className="sectionHead reveal is-visible">
          <h2 className="sectionTitle">小說閱讀器</h2>
          <p className="sectionLead">上傳 TXT 檔案即可開始閱讀。登入後將自動儲存檔案至您的專屬書庫！</p>

          {!isAuthenticated && (
            <div className="readerLoginHint">
              <LogIn size={14} />
              <span>登入帳號可跨裝置同步閱讀進度、新增書籤與筆記</span>
            </div>
          )}

          <div style={{ marginTop: "16px", marginBottom: "16px" }}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setShowFormatInfo(!showFormatInfo)}
              style={{ display: "inline-flex", alignItems: "center", padding: "8px 12px", background: "rgba(0,0,0,0.05)" }}
            >
              <span style={{ marginRight: "8px" }}>格式要求說明</span>
              {showFormatInfo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showFormatInfo && (
              <div style={{
                marginTop: "12px", padding: "16px", background: "rgba(0,0,0,0.03)",
                borderRadius: "8px", fontSize: "14px", lineHeight: "1.6", textAlign: "left"
              }}>
                <h4 style={{ marginTop: 0, marginBottom: "8px" }}>小說檔案格式要求：</h4>
                <ul style={{ margin: 0, paddingLeft: "20px" }}>
                  <li>僅支援 <strong>.txt</strong> 純文字檔案格式。</li>
                  <li><strong>優先格式</strong>：標題行 <code>【第X話 標題】</code> 後緊接 <code>---（五條以上）</code> 分隔線。</li>
                  <li><strong>備用格式</strong>：<code>第X章</code>、<code>第X話</code>、<code>第X回</code>、<code>Chapter X</code>（X 支援半形、全形及漢字數字）。</li>
                  <li>包含「外伝・外傳・特別SS・番外編・篇」等關鍵字的章節，將在列表中自動擷取系列名並以標籤標註。</li>
                  <li>若均未偵測到符合格式的標題，系統將把整份文件視為單一章節。</li>
                </ul>
              </div>
            )}
          </div>

          <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-start", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
            <label className="btn btn--primary" style={{ cursor: "pointer", margin: 0, display: "inline-flex", alignItems: "center" }}>
              <Upload size={18} style={{ marginRight: "8px" }} />
              上傳 TXT 檔
              <input type="file" accept=".txt" onChange={handleFileUpload} style={{ display: "none" }} />
            </label>
            <button className="btn btn--ghost" onClick={loadSampleNovel} style={{ display: "inline-flex", alignItems: "center" }}>
              <BookOpen size={18} style={{ marginRight: "8px" }} />
              載入範例小說
            </button>

            {/* 近期閱讀選單 (僅登入顯示) — 用 portal 渲染至 body 避免父層 stacking context 干擾 */}
            {isAuthenticated && recentBooks.length > 0 && (
              <>
                <button
                  ref={recentBtnRef}
                  className="btn btn--ghost"
                  onClick={() => showRecentBooks ? setShowRecentBooks(false) : openRecentBooks()}
                  style={{ display: "inline-flex", alignItems: "center", borderColor: showRecentBooks ? "var(--line2)" : "var(--line)" }}
                >
                  <LibraryIcon size={18} style={{ marginRight: "8px" }} />
                  近期閱讀
                  <ChevronDown
                    size={14}
                    style={{ marginLeft: "6px", transition: "transform 0.25s", transform: showRecentBooks ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>

                {showRecentBooks && dropdownPos && createPortal(
                  <div
                    className="recentBooksDropdown"
                    style={{
                      position: "fixed",
                      top: dropdownPos.top,
                      left: dropdownPos.left,
                      minWidth: "260px",
                      borderRadius: "var(--radius2)",
                      border: "1px solid var(--line)",
                      background: "color-mix(in srgb, var(--card) 96%, transparent)",
                      backdropFilter: "blur(16px)",
                      boxShadow: "var(--shadow)",
                      padding: "6px",
                      zIndex: 99999,
                      animation: "dropdownIn .2s var(--ease)",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", padding: "4px 10px 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      最近閱讀的書籍
                    </div>
                    <div style={{ height: "1px", background: "var(--line)", margin: "0 0 6px" }} />
                    {recentBooks.slice(0, 5).map((b, idx) => (
                      <button
                        key={b.id}
                        className="userMenu__item"
                        style={{ flexDirection: "column", alignItems: "flex-start", padding: "9px 12px", gap: "3px", borderRadius: "10px", width: "100%" }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setShowRecentBooks(false);
                          const targetId = b.id.toString();
                          if (searchParams.get("bookId") === targetId) {
                            loadBookFromServer(b.id);
                          } else {
                            setSearchParams({ bookId: targetId });
                          }
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                          <span style={{
                            width: "22px", height: "22px", borderRadius: "6px", flexShrink: 0,
                            background: `hsl(${(b.id * 47) % 360}, 65%, 55%)`,
                            display: "grid", placeItems: "center", fontSize: "11px", fontWeight: 800, color: "#fff"
                          }}>
                            {idx + 1}
                          </span>
                          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>
                            {b.novel_name}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingLeft: "30px" }}>
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                            第 {b.current_chapter + 1} 章 / 共 {b.total_chapters} 章
                          </span>
                          {b.total_chapters > 0 && (
                            <span style={{
                              fontSize: "10px", padding: "1px 6px", borderRadius: "999px",
                              background: `hsl(${Math.round((b.current_chapter / b.total_chapters) * 120)}, 60%, 50%)`,
                              color: "#fff", fontWeight: 700
                            }}>
                              {Math.round((b.current_chapter / b.total_chapters) * 100)}%
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </>
            )}
          </div>
        </div>

        <div className="card reveal is-visible" style={isFullScreen ? {
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 9998, margin: 0, borderRadius: 0, display: "flex",
          flexDirection: "column", height: "100vh", overflowY: "auto",
          backgroundColor: getThemeStyles().backgroundColor, color: getThemeStyles().color,
        } : { position: "relative", display: "flex", flexDirection: "column" }}>

          {/* Toolbar */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              {chapters.length > 0 && (
                <span style={{ fontSize: "14px", color: "var(--muted)", marginRight: "10px", display: "flex", alignItems: "center" }}>
                  {currentChapter + 1} / {chapters.length} 章
                </span>
              )}
              {chapters.length > 0 && (
                <button className="btn btn--ghost btn--sm" onClick={() => setShowChapterList(true)} title="章節列表">
                  <List size={18} />
                </button>
              )}

              {isAuthenticated && currentBookRecord && chapters.length > 0 && (
                <button className="btn btn--ghost btn--sm" onClick={() => { setShowBookmarkPanel(!showBookmarkPanel); }} title="加入書籤">
                  <BookmarkPlus size={18} />
                </button>
              )}

              <button className="btn btn--ghost btn--sm" onClick={() => setShowSettings(!showSettings)} title="閱讀設定">
                <Settings2 size={18} />
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setIsFullScreen(!isFullScreen)} title={isFullScreen ? "退出全螢幕" : "全螢幕"}>
                {isFullScreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>

          {/* 面板們... (書籤/筆記/設定) */}
          {showBookmarkPanel && (
            <div className="callout readerPanel" style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span className="callout__title" style={{ fontSize: "14px", fontWeight: 700 }}>
                  <BookmarkPlus size={16} style={{ verticalAlign: "middle", marginRight: "6px" }} />
                  為「{chapters[currentChapter]?.title}」加入書籤
                </span>
                <button className="btn btn--ghost btn--sm" onClick={() => setShowBookmarkPanel(false)}><X size={14} /></button>
              </div>
              <textarea placeholder="備註（選填）" value={bookmarkNote} onChange={(e) => setBookmarkNote(e.target.value)} rows={2} style={{ width: "100%", marginBottom: "10px" }} />
              <button className="btn btn--primary btn--sm" onClick={handleAddBookmark}><BookmarkPlus size={14} /> 加入書籤</button>
            </div>
          )}


          {showSettings && (
            <div className="callout" style={{ marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap" }}>
              <div>
                <span className="callout__title" style={{ display: "block", marginBottom: "8px" }}>字體大小</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="btn btn--ghost btn--sm" onClick={() => setFontSize(f => Math.max(12, f - 2))}>A-</button>
                  <span style={{ display: "inline-flex", alignItems: "center" }}>{fontSize}px</span>
                  <button className="btn btn--ghost btn--sm" onClick={() => setFontSize(f => Math.min(32, f + 2))}>A+</button>
                </div>
              </div>
              <div>
                <span className="callout__title" style={{ display: "block", marginBottom: "8px" }}>閱讀主題</span>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button className={`btn btn--sm ${readerTheme === 'light' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setReaderTheme('light')}>明亮</button>
                  <button className={`btn btn--sm ${readerTheme === 'sepia' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setReaderTheme('sepia')}>護眼</button>
                  <button className={`btn btn--sm ${readerTheme === 'dark' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setReaderTheme('dark')}>深色</button>
                  <button className={`btn btn--sm ${readerTheme === 'gray' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setReaderTheme('gray')}>灰色</button>
                  <button className={`btn btn--sm ${readerTheme === 'green' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setReaderTheme('green')}>淺綠</button>
                </div>
              </div>
            </div>
          )}

          {/* Reader Area */}
          <div
            ref={readerRef}
            style={{
              ...getThemeStyles(),
              borderRadius: isFullScreen ? "0" : "12px",
              padding: isFullScreen ? "5vw 10vw" : "24px",
              minHeight: "400px",
              maxHeight: isFullScreen ? "none" : "60vh",
              flex: isFullScreen ? 1 : "auto",
              overflowY: "auto",
              transition: "background-color 0.3s, color 0.3s"
            }}
          >
            {isLoadingFile ? (
              <div style={{ display: "flex", flexDirection: "column", height: "100%", alignItems: "center", justifyContent: "center", color: "inherit", opacity: 0.6, gap: "10px" }}>
                <Loader2 size={32} className="spinIcon" />
                <span>讀取檔案中...</span>
              </div>
            ) : chapters.length === 0 ? (
              <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "inherit", opacity: 0.6 }}>
                請上傳小說檔案以開始閱讀...
              </div>
            ) : (
              <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
                <h3 style={{ fontSize: `${fontSize * 1.5}px`, marginTop: 0, marginBottom: "24px", borderBottom: "1px solid currentColor", paddingBottom: "12px" }}>
                  {chapters[currentChapter].title}
                </h3>
                <div style={{ fontSize: `${fontSize}px`, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
                  {chapters[currentChapter].content}
                </div>
              </div>
            )}
          </div>

          {/* Pagination */}
          {!isLoadingFile && chapters.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "16px" }}>
              <button className="btn btn--ghost" disabled={currentChapter === 0} onClick={() => setCurrentChapter(c => Math.max(0, c - 1))}>
                <ChevronLeft size={18} /> 上一章
              </button>
              <button className="btn btn--ghost" disabled={currentChapter === chapters.length - 1} onClick={() => setCurrentChapter(c => Math.min(chapters.length - 1, c + 1))}>
                下一章 <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>

        {/* Chapter List Sidebar */}
        {showChapterList && (
          <>
            <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 9999 }} onClick={() => setShowChapterList(false)} />
            <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "300px", maxWidth: "80vw", ...getThemeStyles(), zIndex: 10000, padding: "20px", boxShadow: "-2px 0 10px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h3 style={{ margin: 0 }}>章節列表</h3>
                <button className="btn btn--ghost btn--sm" onClick={() => setShowChapterList(false)}><X size={20} /></button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", flex: 1, paddingRight: "8px" }}>
                {chapters.map((chap, idx) => (
                  <button
                    key={idx} id={`chapter-${idx}`}
                    onClick={() => { setCurrentChapter(idx); setShowChapterList(false); }}
                    style={{
                      textAlign: "left", padding: "10px 14px", borderRadius: "6px", border: "none",
                      background: currentChapter === idx ? (readerTheme === 'dark' ? '#333' : 'rgba(0,0,0,0.08)') : 'transparent',
                      color: "inherit", cursor: "pointer", fontWeight: currentChapter === idx ? "bold" : "normal",
                      display: "flex", flexDirection: "column", gap: "3px", alignItems: "flex-start", width: "100%"
                    }}
                  >
                    {chap.gaidenBadge && (
                      <span style={{
                        fontSize: "10px",
                        background: "hsl(280, 65%, 55%)",
                        color: "#fff",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        flexShrink: 0,
                        lineHeight: 1.6,
                      }}>{chap.gaidenBadge}</span>
                    )}
                    <span style={{ lineHeight: 1.4 }}>{chap.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Toast 通知 */}
        {toast && <div className="toast readerToast">{toast}</div>}
      </div>
    </section>
  );
}
