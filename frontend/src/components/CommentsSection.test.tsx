import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommentsSection } from "./CommentsSection";
import * as gamesApi from "../lib/api/games";
import type { PublicComment } from "../lib/api/games";

vi.mock("../lib/api/games");

const mockedGetComments = vi.mocked(gamesApi.getComments);
const mockedPostComment = vi.mocked(gamesApi.postComment);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("CommentsSection", () => {
  it("shows a loading state before comments arrive", () => {
    mockedGetComments.mockReturnValue(new Promise(() => {}));
    render(<CommentsSection slug="swift-otter" />);
    expect(screen.getByText(/loading comments/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no comments", async () => {
    mockedGetComments.mockResolvedValue([]);
    render(<CommentsSection slug="swift-otter" />);
    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());
  });

  it("shows a distinct error when comments fail to load, without an empty-state or form", async () => {
    mockedGetComments.mockRejectedValue(new Error("Internal error"));
    render(<CommentsSection slug="swift-otter" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't be loaded/i));
    expect(screen.queryByText(/no comments yet/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
  });

  it("renders existing comments, showing 'Anonymous' for a null authorName", async () => {
    const comments: PublicComment[] = [
      { id: "c1", authorName: "Alice", text: "Great squad!", createdAt: 1 },
      { id: "c2", authorName: null, text: "Nice one", createdAt: 2 },
    ];
    mockedGetComments.mockResolvedValue(comments);
    render(<CommentsSection slug="swift-otter" />);

    await waitFor(() => expect(screen.getByText("Great squad!")).toBeInTheDocument());
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Nice one")).toBeInTheDocument();
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
  });

  it("disables posting until a comment and either a name or anonymous is provided", async () => {
    mockedGetComments.mockResolvedValue([]);
    render(<CommentsSection slug="swift-otter" />);
    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());

    const submit = screen.getByRole("button", { name: /post/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Nice work" } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Bob" } });
    expect(submit).not.toBeDisabled();
  });

  it("allows posting anonymously without a name", async () => {
    mockedGetComments.mockResolvedValue([]);
    mockedPostComment.mockResolvedValue({ id: "c3", authorName: null, text: "Nice work", createdAt: 3 });
    render(<CommentsSection slug="swift-otter" />);
    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Nice work" } });
    fireEvent.click(screen.getByLabelText(/post anonymously/i));
    expect(screen.getByRole("button", { name: /post/i })).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /post/i }));
    });

    expect(mockedPostComment).toHaveBeenCalledWith("swift-otter", { text: "Nice work", authorName: null });
    await waitFor(() => expect(screen.getByText("Nice work")).toBeInTheDocument());
  });

  it("posts a named comment and appends it to the list", async () => {
    mockedGetComments.mockResolvedValue([]);
    mockedPostComment.mockResolvedValue({ id: "c4", authorName: "Bob", text: "Great!", createdAt: 4 });
    render(<CommentsSection slug="swift-otter" />);
    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Great!" } });
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Bob" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /post/i }));
    });

    expect(mockedPostComment).toHaveBeenCalledWith("swift-otter", { text: "Great!", authorName: "Bob" });
    await waitFor(() => expect(screen.getByText("Great!")).toBeInTheDocument());
  });

  it("shows an error message when posting fails", async () => {
    mockedGetComments.mockResolvedValue([]);
    mockedPostComment.mockRejectedValue(new Error("Comment flagged as inappropriate"));
    render(<CommentsSection slug="swift-otter" />);
    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "bad word" } });
    fireEvent.click(screen.getByLabelText(/post anonymously/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /post/i }));
    });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Comment flagged as inappropriate"));
  });
});
