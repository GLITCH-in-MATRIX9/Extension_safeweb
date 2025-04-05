import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  PieController,
  Tooltip
} from "chart.js";
import jsPDF from "jspdf";
import { Download, Loader2, RefreshCw } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import "~popup.css";

// Register Chart.js components
Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ArcElement,
  PieController
);

interface ToxicityResult {
  sentence: string;
  results: Record<string, string>;
}

interface Report {
  success: boolean;
  results: ToxicityResult[];
  timestamp?: string;
  website?: string;
}

const ReportsPage = () => {
  const [report, setReport] = useState<Report>({ success: false, results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blurIntensity, setBlurIntensity] = useState(5);
  const [isBlurEnabled, setIsBlurEnabled] = useState(true);
  const barChartRef = useRef<HTMLCanvasElement | null>(null);
  const pieChartRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    chrome.storage.local.get(
      ["report", "blurIntensity", "isBlurEnabled"],
      (result) => {
        if (result.report) {
          setReport({
            success: result.report.success || false,
            results: result.report.results || [],
            timestamp: result.report.timestamp || new Date().toISOString(),
            website: result.report.website || "Unknown"
          });
          setLoading(false);
        } else {
          fetchPageText();
        }

        if (result.blurIntensity !== undefined) {
          setBlurIntensity(result.blurIntensity);
        }
        if (result.isBlurEnabled !== undefined) {
          setIsBlurEnabled(result.isBlurEnabled);
        }
      }
    );
  }, []);

  const calculateMaxToxicity = (results: Record<string, string>) => {
    const relevantCategories = [
      "toxicity",
      "severe_toxicity",
      "obscene",
      "identity_attack",
      "insult",
      "threat"
    ];

    const scores = relevantCategories
      .map((category) => parseFloat(results[category] || "0"))
      .filter((score) => !isNaN(score));

    return scores.length > 0 ? Math.max(...scores) : 0;
  };

  const applyBlurEffects = (
    blurIntensity: number,
    isBlurEnabled: boolean,
    toxicSelectors: string[],
    nonToxicSelectors: string[],
    isWhatsApp: boolean
  ) => {
    // Clean up existing classes
    document.querySelectorAll(".toxic-text, .not-toxic-text").forEach((el) => {
      el.classList.remove("toxic-text", "not-toxic-text");
      el.style.filter = "";
    });

    // Apply blur to toxic elements
    toxicSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (!el) return;

        el.classList.add("toxic-text");
        if (isBlurEnabled) {
          // Special handling for WhatsApp
          if (isWhatsApp) {
            const container = el.closest('[data-testid="msg-container"]');
            if (container) {
              container.classList.add("toxic-text");
              container.style.filter = `blur(${blurIntensity}px)`;
              container.style.transition = "filter 0.3s ease";
            }
          }
          el.style.filter = `blur(${blurIntensity}px)`;
          el.style.transition = "filter 0.3s ease";
        }
      });
    });

    // Mark non-toxic elements
    nonToxicSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (el) el.classList.add("not-toxic-text");
      });
    });
  };

  const analyzeToxicity = async (
    sentences: { text: string; selector: string; uniqueId: string | null }[],
    website: string
  ) => {
    console.log("📢 Analyzing toxicity with Detoxify...");
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("http://localhost:5000/api/analyze-toxicity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sentences: sentences.map((s) => s.text)
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success || !Array.isArray(data.results)) {
        throw new Error("Invalid response from the backend");
      }

      console.log("🧪 Analysis complete:", data.results);

      setReport({
        success: true,
        results: data.results,
        timestamp: data.timestamp,
        website: website
      });

      chrome.storage.local.set({
        report: { success: true, results: data.results }
      });

      // Apply blur effect to toxic elements
      const toxicSelectors = new Set<string>();
      const nonToxicSelectors = new Set<string>();
      const isWhatsApp = website.includes("web.whatsapp.com");

      data.results.forEach((result: ToxicityResult, index: number) => {
        const maxToxicity = calculateMaxToxicity(result.results);
        if (maxToxicity > 70) {
          let selector = sentences[index].selector;
          toxicSelectors.add(`${selector}.toxic-text`);

          // Special handling for WhatsApp
          if (isWhatsApp && selector.includes("._ao3e")) {
            toxicSelectors.add(`[data-testid="msg-container"] ${selector}`);
          }
        } else {
          nonToxicSelectors.add(sentences[index].selector + `.not-toxic-text`);
        }
      });

      console.log("Final Toxic Selectors:", Array.from(toxicSelectors));

      if (toxicSelectors.size > 0) {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          const activeTab = tabs[0];
          if (activeTab.id) {
            try {
              // First inject the CSS
              await chrome.scripting.insertCSS({
                target: { tabId: activeTab.id },
                css: `
                  [data-testid="msg-container"].toxic-text {
                    filter: blur(${blurIntensity}px) !important;
                    transition: filter 0.3s ease !important;
                  }
                  [data-testid="msg-container"].toxic-text ._ao3e.copyable-text.selectable-text {
                    filter: none !important;
                  }
                `
              });

              // Then execute the script
              await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: applyBlurEffects,
                args: [
                  blurIntensity,
                  isBlurEnabled,
                  Array.from(toxicSelectors),
                  Array.from(nonToxicSelectors),
                  isWhatsApp
                ]
              });

              console.log("Blur effects applied successfully");
            } catch (err) {
              console.error("Failed to apply blur effects:", err);
            }
          }
        });

        // Show notification
        if (chrome.notifications) {
          chrome.notifications.create({
            type: "basic",
            iconUrl: "icon128.png",
            title: "Toxicity Detected",
            message: "⚠️ Toxicity detected! Please review the toxicity report."
          });
        }
      }
    } catch (error) {
      console.error("❌ Error analyzing toxicity:", error);
      setError(error.message || "Error analyzing toxicity. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const fetchPageText = () => {
    console.log("🔍 Fetching page text...");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab.id) {
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            func: () => {
              const selectors = {
                "web.whatsapp.com": "._ao3e.copyable-text.selectable-text",
                "twitter.com": "div[data-testid='tweetText']",
                "reddit.com": "div[data-testid='comment']",
                default: ".message-content, .comment-text"
              };

              const website = window.location.hostname;
              const selector = selectors[website] || selectors.default;

              const textElements = document.querySelectorAll(selector);
              const texts = Array.from(textElements).map((el) => ({
                text: el.innerText.trim(),
                selector: selector,
                uniqueId: el.id || el.getAttribute("data-id") || null
              }));

              return {
                texts,
                website
              };
            }
          },
          (results) => {
            if (results && results[0] && results[0].result) {
              console.log("📜 Page text fetched!");
              const { texts, website } = results[0].result;

              if (!Array.isArray(texts)) {
                console.error("Invalid texts input: expected an array");
                setError("Failed to fetch page content: invalid data format");
                setLoading(false);
                return;
              }

              console.log("Texts:", texts);

              const sentences = texts.flatMap((msg) => {
                const sentences = msg.text
                  .split(/[.!?]/)
                  .filter((s) => s.trim());
                return sentences.map((sentence) => ({
                  text: sentence.trim(),
                  selector: msg.selector,
                  uniqueId: msg.uniqueId
                }));
              });

              console.log("Sentences:", sentences);
              analyzeToxicity(sentences, website);
            } else {
              console.error("❌ Failed to fetch page content");
              setError("Failed to fetch page content");
              setLoading(false);
            }
          }
        );
      } else {
        console.error("❌ No active tab found");
        setError("No active tab found");
        setLoading(false);
      }
    });
  };

  useEffect(() => {
    if (barChartRef.current && report.results.length > 0) {
      const ctx = barChartRef.current.getContext("2d");
      if (ctx) {
        const labels = Object.keys(report.results[0].results);
        const data = labels.map((label) =>
          parseFloat(report.results[0].results[label])
        );

        new Chart(ctx, {
          type: "bar",
          data: {
            labels: labels,
            datasets: [
              {
                label: "Toxicity Scores (%)",
                data: data,
                backgroundColor: "rgba(255, 99, 132, 0.2)",
                borderColor: "rgba(255, 99, 132, 1)",
                borderWidth: 1
              }
            ]
          },
          options: {
            scales: {
              y: {
                beginAtZero: true,
                max: 100
              }
            }
          }
        });
      }
    }
  }, [report]);

  useEffect(() => {
    if (pieChartRef.current && report.results.length > 0) {
      const ctx = pieChartRef.current.getContext("2d");
      if (ctx) {
        const labels = Object.keys(report.results[0].results);
        const data = labels.map((label) =>
          parseFloat(report.results[0].results[label])
        );

        new Chart(ctx, {
          type: "pie",
          data: {
            labels: labels,
            datasets: [
              {
                label: "Toxicity Distribution (%)",
                data: data,
                backgroundColor: [
                  "rgba(255, 99, 132, 0.2)",
                  "rgba(54, 162, 235, 0.2)",
                  "rgba(255, 206, 86, 0.2)",
                  "rgba(75, 192, 192, 0.2)",
                  "rgba(153, 102, 255, 0.2)",
                  "rgba(255, 159, 64, 0.2)"
                ],
                borderColor: [
                  "rgba(255, 99, 132, 1)",
                  "rgba(54, 162, 235, 1)",
                  "rgba(255, 206, 86, 1)",
                  "rgba(75, 192, 192, 1)",
                  "rgba(153, 102, 255, 1)",
                  "rgba(255, 159, 64, 1)"
                ],
                borderWidth: 1
              }
            ]
          }
        });
      }
    }
  }, [report]);

  const downloadReport = () => {
    if (report && barChartRef.current && pieChartRef.current) {
      const doc = new jsPDF();

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("Toxicity Report by SafeWeb", 10, 10);

      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text(`Website: ${report.website || "Unknown"}`, 10, 20);

      doc.text(
        `Timestamp: ${new Date(report.timestamp || new Date().toISOString()).toLocaleString()}`,
        10,
        30
      );

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Toxicity Scores (%)", 10, 40);

      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      let y = 50;
      report.results.forEach((result) => {
        Object.entries(result.results).forEach(([label, score]) => {
          doc.text(`${label}: ${score}%`, 10, y);
          y += 10;
        });
      });

      const barChartImage = barChartRef.current.toDataURL("image/png");
      const pieChartImage = pieChartRef.current.toDataURL("image/png");

      doc.addPage();
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Bar Chart: Toxicity Scores (%)", 10, 10);
      doc.addImage(barChartImage, "PNG", 10, 20, 180, 100);

      doc.addPage();
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Pie Chart: Toxicity Distribution (%)", 10, 10);
      doc.addImage(pieChartImage, "PNG", 10, 20, 180, 100);

      doc.save(`toxicity_report_${report.timestamp || "unknown"}.pdf`);
    }
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <Loader2 className="spinner w-8 h-8 animate-spin text-blue-500" />
        <p className="ml-2 text-gray-600">Analyzing your texts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-message">
        <div className="error-title">Error</div>
        <div className="error-detail">{error}</div>
      </div>
    );
  }

  return (
    <div className="report-container">
      <h2 className="report-header">Toxicity Report</h2>

      <div className="buttons-container">
        <button onClick={downloadReport} className="download-button">
          <Download className="icon" />
          Download Report (PDF)
        </button>

        <button onClick={fetchPageText} className="analyze-again-button">
          <RefreshCw className="icon" />
          Analyze Again
        </button>
      </div>

      {report.results.length > 0 ? (
        <div className="space-y-4">
          <div className="timestamp">
            <strong>Timestamp:</strong>{" "}
            {new Date(
              report.timestamp || new Date().toISOString()
            ).toLocaleString()}
          </div>
          <h3 className="text-lg font-semibold text-gray-700">
            Visualizations (%)
          </h3>
          <div className="charts-container">
            <div>
              <h4 className="chart-title">Toxicity Scores</h4>
              <canvas ref={barChartRef} width="380" height="200"></canvas>
            </div>
            <div>
              <h4 className="chart-title">Toxicity Distribution</h4>
              <canvas ref={pieChartRef} width="380" height="200"></canvas>
            </div>
          </div>
          
          <h3 className="text-lg font-semibold text-gray-700">
            Toxicity Scores (%)
          </h3>
          <table className="toxicity-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {report.results.map((result, index) => (
                <tr key={index}>
                  <td>{result.sentence}</td>
                  <td>
                    <ul>
                      {Object.entries(result.results).map(([label, score]) => (
                        <li key={label}>
                          {label}: {score}%
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="no-toxicity">
          <span>🎉 No toxicity detected!</span>
        </div>
      )}
    </div>
  );
};

export default ReportsPage;